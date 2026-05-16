import { VectorStore } from "../vector_store";
import { S3VectorsClient, PutVectorsCommand, QueryVectorsCommand, GetVectorsCommand, DeleteVectorsCommand, CreateIndexCommand } from "@aws-sdk/client-s3vectors";
import { env } from "../cfg";

export class S3VectorStore implements VectorStore {
    private client: S3VectorsClient;
    private initialized = false;

    constructor() {
        this.client = new S3VectorsClient({
            region: env.AWS_REGION || "us-east-1",
            credentials: (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
                ? {
                    accessKeyId: env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {})
                }
                : undefined
        });
    }

    private async ensureIndexExists(dim: number): Promise<void> {
        if (this.initialized) return;
        try {
            await this.client.send(new CreateIndexCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                dataType: "float32",
                dimension: dim,
                distanceMetric: "cosine"
            }));
            this.initialized = true;
        } catch (e: any) {
            if (e.name === "ResourceInUseException" || e.name === "ConflictException" || e.name === "AlreadyExistsException" || e.$metadata?.httpStatusCode === 409 || e.toString().includes("already exists") || (e.name === "BadRequestException" && e.message.includes("already exists"))) {
                this.initialized = true;
            } else {
                console.warn("[S3Vectors] Could not pre-create index (it might already exist):", e.message);
                this.initialized = true;
            }
        }
    }

    async storeVector(id: string, sector: string, vector: number[], dim: number, user_id?: string, project_id?: string): Promise<void> {
        console.error(`[S3Vectors] Storing vector 1 ${id}:`, id, sector, vector, dim, user_id, project_id);
        await this.ensureIndexExists(dim);
        console.error(`[S3Vectors] Storing vector 2 ${id}:`, id, sector, vector, dim, user_id, project_id);
        try {
            const metadata: any = {
                sector: sector,
                dim: dim.toString()
            };
            if (user_id) metadata.user_id = user_id;
            if (project_id) metadata.project_id = project_id;

            await this.client.send(new PutVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                vectors: [{
                    key: `${id}_${sector}`,
                    data: { float32: vector },
                    metadata: metadata
                }]
            }));
        } catch (e: any) {
            console.error(`[S3Vectors] Failed to store vector ${id}_${sector}:`, e?.message || e);
            throw e;
        }
    }

    async deleteVector(id: string, sector: string): Promise<void> {
        try {
            await this.client.send(new DeleteVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                keys: [`${id}_${sector}`, id]
            }));
        } catch (e) {
            console.error(`[S3Vectors] Failed to delete vector ${id}_${sector}`, e);
        }
    }

    async deleteVectors(id: string): Promise<void> {
        try {
            const keysToDelete = ["episodic", "semantic", "procedural", "emotional", "reflective"].map(s => `${id}_${s}`);
            keysToDelete.push(id);
            await this.client.send(new DeleteVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                keys: keysToDelete
            }));
        } catch (e) {
            console.error("[S3Vectors] Failed to delete vectors", id, e);
        }
    }

    async searchSimilar(sector: string, queryVec: number[], topK: number, user_id?: string, project_id?: string): Promise<Array<{ id: string; score: number }>> {
        const needsPostFilter = !!(sector || user_id || project_id);
        const fetchK = Math.min(100, needsPostFilter ? topK * 5 : topK);

        try {
            const resp = await this.client.send(new QueryVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                queryVector: { float32: queryVec },
                topK: fetchK,
                returnMetadata: true,
                returnDistance: true
            }));

            const matches = resp.vectors || [];
            const results: Array<{ id: string; score: number }> = [];

            for (const match of matches) {
                const meta = (match.metadata as Record<string, any>) || {};

                if (sector && meta.sector !== sector) continue;
                if (user_id && meta.user_id && meta.user_id !== user_id) continue;
                if (project_id && meta.project_id && meta.project_id !== project_id) continue;

                results.push({
                    id: match.key as string,
                    score: 1.0 - (match.distance || 0)
                });

                if (results.length >= topK) break;
            }

            return results.sort((a, b) => b.score - a.score);
        } catch (e) {
            console.error("[S3Vectors] Search failed:", e);
            return [];
        }
    }

    async getVector(id: string, sector: string): Promise<{ vector: number[]; dim: number } | null> {
        try {
            const resp = await this.client.send(new GetVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                keys: [`${id}_${sector}`, id],
                returnData: true,
                returnMetadata: true
            }));

            const vectors = resp.vectors || [];
            if (vectors.length === 0) return null;

            // Preferred: the one with the exact key `${id}_${sector}`
            let v = vectors.find((vec: any) => vec.key === `${id}_${sector}`);
            if (!v) v = vectors[0];

            const data = v.data?.float32 || [];
            const meta = (v.metadata as Record<string, any>) || {};

            return {
                vector: data,
                dim: parseInt((meta.dim as string) || data.length.toString())
            };
        } catch (e) {
            console.warn(`[S3Vectors] Could not get vector ${id}_${sector}:`, e);
            return null;
        }
    }

    async getVectorsById(id: string): Promise<Array<{ sector: string; vector: number[]; dim: number }>> {
        try {
            const keysToFetch = ["episodic", "semantic", "procedural", "emotional", "reflective"].map(s => `${id}_${s}`);
            keysToFetch.push(id);
            const resp = await this.client.send(new GetVectorsCommand({
                vectorBucketName: env.s3_bucket,
                indexName: env.s3_index_name,
                keys: keysToFetch,
                returnData: true,
                returnMetadata: true
            }));
            const vectors = resp.vectors || [];
            return vectors.map((v: any) => ({
                sector: ((v.metadata as Record<string, any>)?.sector as string) || "default",
                vector: v.data?.float32 || [],
                dim: parseInt(((v.metadata as Record<string, any>)?.dim as string) || (v.data?.float32?.length || 0).toString())
            }));
        } catch (e) {
            return [];
        }
    }

    async getVectorsBySector(sector: string): Promise<Array<{ id: string; vector: number[]; dim: number }>> {
        // Unused by core logic largely except in legacy/migration ops
        return [];
    }
}
