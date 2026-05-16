-- create-hnsw-index.sql
--
-- 第十一章 11.5 — pgvector HNSW 索引脚本
--
-- 部署顺序（重要）：
--   1. 先全量入库，把 document_chunks(embedding) 填满（数十万条不建议边写边建索引）
--   2. 最后一次性执行本脚本建索引（100 万条大约 10–30 分钟）
--   3. 上线后查询前 `SET hnsw.ef_search = 100;` 用作"质量 vs 延迟"旋钮
--
-- 删除索引：DROP INDEX IF EXISTS idx_chunks_embedding;
-- 换 Embedding 模型 = 重建表 + 重跑本脚本（参考 11.12 Q4）

CREATE EXTENSION IF NOT EXISTS vector;

-- 11.5.3 关键参数：
--   m=16            -- 每层每节点最大连接数（中小规模 16，超大规模 32–48）
--   ef_construction=64  -- 建索引时考察候选数（64–200，越大质量越好但建库慢）
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 推荐：在常用过滤字段上建辅助 B-tree 索引（11.8.5 元数据过滤）
CREATE INDEX IF NOT EXISTS idx_chunks_documentid ON document_chunks ("documentId");

-- 查询时调旋钮（按 session 设置，越大召回越高、延迟越高）
-- SET hnsw.ef_search = 100;
