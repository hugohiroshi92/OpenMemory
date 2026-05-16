import logging
import asyncio
import json
from typing import List, Optional, Dict, Any
import numpy as np

from ..vector_store import VectorStore, VectorRow

logger = logging.getLogger("vector_store.s3")

class S3VectorStore(VectorStore):
    def __init__(self, bucket: str, prefix: str = "om-vectors/"):
        self.bucket = bucket
        # S3 Vectors uses indices within vector buckets, not prefixes! Let's treat prefix as the index name.
        self.index_name = prefix.strip('/') 
        self._s3v_client = None
        self._initialized = False

    def _get_client(self):
        """Lazy load boto3 client."""
        if self._s3v_client is None:
            import boto3
            from ..config import env
            import os
            
            # Extract region from config or env, defaulting to us-east-1
            region = env.aws_region or os.getenv("AWS_DEFAULT_REGION", "us-east-1")
            
            # Use default session which automatically inherits ECS IAM roles and environment variables
            # Use s3vectors for Amazon S3 Vector functionality
            self._s3v_client = boto3.client('s3vectors', region_name=region)
        return self._s3v_client

    async def _ensure_index_exists(self, dim: int):
        if self._initialized:
             return
             
        s3v = self._get_client()
        
        def _check_and_create():
            try:
                # First check if the index already exists.
                # Currently s3vectors lacks a describe_index that doesn't throw if absent,
                # but we can try listing or just attempt to create and catch ResourceInUseException (or similar)
                import botocore.exceptions
                try:
                    s3v.create_index(
                        vectorBucketName=self.bucket,
                        indexName=self.index_name,
                        dimension=dim,
                        dataType='float32',
                        distanceMetric='cosine' # OpenMemory standard
                    )
                    logger.info(f"Created new S3 Vector index '{self.index_name}' in bucket '{self.bucket}'")
                except botocore.exceptions.ClientError as e:
                    error_code = e.response['Error']['Code']
                    if error_code in ('ConflictException', 'ResourceInUseException', 'BucketAlreadyOwnedByYou'):
                        # Index likely exists already.
                        pass
                    else:
                        logger.warning(f"Error checking/creating S3 Vector index: {e}")
            except Exception as e:
                logger.warning(f"Error handling S3 vector index creation: {e}")

        await asyncio.to_thread(_check_and_create)
        self._initialized = True

    async def storeVector(self, id: str, sector: str, vector: List[float], dim: int, user_id: Optional[str] = None):
        await self._ensure_index_exists(dim)
        s3v = self._get_client()
        
        # Amazon S3 Vectors expects vectors alongside metadata.
        # We store the sector and user_id in the metadata object.
        metadata = {
            "sector": sector,
            "user_id": user_id or ""
        }

        # The s3vectors PutVectors API expects a list of objects
        def _upload():
            s3v.put_vectors(
                vectorBucketName=self.bucket,
                indexName=self.index_name,
                vectors=[
                    {
                        "key": id,
                        "data": {"float32": vector},
                        "metadata": metadata
                    }
                ]
            )

        await asyncio.to_thread(_upload)

    async def getVectorsById(self, id: str) -> List[VectorRow]:
        s3v = self._get_client()

        def _fetch():
            try:
                resp = s3v.get_vectors(
                    vectorBucketName=self.bucket,
                    indexName=self.index_name,
                    keys=[id],
                    returnData=True,
                    returnMetadata=True
                )
                return resp.get('vectors', [])
            except Exception as e:
                logger.warning(f"Could not get vector {id} from S3 Vectors: {e}")
                return []

        vectors_data = await asyncio.to_thread(_fetch)
        
        res = []
        for v in vectors_data:
            meta = v.get('metadata', {})
            
            # The data returned matches the struct injected, e.g. {"float32": [...]}
            vec_data = v.get("data", {})
            vector_values = vec_data.get("float32", [])
            
            res.append(VectorRow(
                id=v["key"],
                sector=meta.get("sector", ""),
                vector=vector_values,
                dim=len(vector_values)
            ))
        return res

    async def getVector(self, id: str, sector: str) -> Optional[VectorRow]:
        rows = await self.getVectorsById(id)
        for r in rows:
            if r.sector == sector:
                return r
        return None

    async def deleteVectors(self, id: str):
        s3v = self._get_client()

        def _delete():
            try:
                s3v.delete_vectors(
                    vectorBucketName=self.bucket,
                    indexName=self.index_name,
                    keys=[id]
                )
            except Exception as e:
                logger.warning(f"Failed to delete {id} from S3 Vectors: {e}")

        await asyncio.to_thread(_delete)

    async def search(self, vector: List[float], sector: str, k: int, filter: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        s3v = self._get_client()

        # To avoid strict and undocumented S3 Vector metadata schema filtering requirements
        # at index creation time, we will over-fetch and filter locally.
        fetch_k = k * 5 if (sector or filter) else k

        def _query():
            kwargs = {
                "vectorBucketName": self.bucket,
                "indexName": self.index_name,
                "queryVector": {"float32": vector},
                "topK": fetch_k,
                "returnMetadata": True,
                "returnDistance": True
            }
            try:
                resp = s3v.query_vectors(**kwargs)
                return resp.get('vectors', [])
            except Exception as e:
                logger.error(f"Failed to search S3 Vectors: {e}")
                return []

        matches = await asyncio.to_thread(_query)
        
        results = []
        for match in matches:
            meta = match.get('metadata', {})
            
            # Local filtering
            if sector and meta.get('sector') != sector:
                continue
            if filter and filter.get('user_id') and meta.get('user_id') != filter['user_id']:
                continue
                
            results.append({
                "id": match["key"],
                "similarity": 1.0 - match.get("distance", 0.0) # Convert distance to similarity
            })
            
            if len(results) >= k:
                break

        # Ensure sorted
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results
