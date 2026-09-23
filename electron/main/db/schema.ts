// SQLite Schema —— 对齐设计文档《天枢-工作流引擎设计》§9
// ID 用 TEXT(UUID);时间戳用 INTEGER(Unix ms);JSON 字段用 TEXT
// 大产物(截图/图片/音频)不进库,只存路径 + hash + 大小

// 版本 1 的全部建表语句(按依赖顺序)
export const SCHEMA_V1 = `
-- ===== 迁移版本记录 =====
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- ===== 项目与世界 =====
CREATE TABLE IF NOT EXISTS project (
  id             TEXT PRIMARY KEY,
  path           TEXT NOT NULL,
  name           TEXT NOT NULL,
  godot_version  TEXT,
  last_opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  title       TEXT,
  kind        TEXT,          -- chat / planning / ...
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_project ON conversation(project_id);
CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation(created_at);

CREATE TABLE IF NOT EXISTS message (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,      -- system / user / assistant / tool
  content         TEXT NOT NULL,
  model           TEXT,               -- 调用的模型名
  tokens          INTEGER,            -- 消耗 token 数
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_conv ON message(conversation_id, created_at);

-- ===== 工作流(菜谱:不可变 revision)=====
CREATE TABLE IF NOT EXISTS workflow (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  tags        TEXT,            -- JSON array
  status      TEXT NOT NULL DEFAULT 'active',  -- active / archived
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_status ON workflow(status);

CREATE TABLE IF NOT EXISTS workflow_revision (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  version      INTEGER NOT NULL,
  spec_json    TEXT NOT NULL,          -- 冻结的 spec
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'published',  -- draft / published
  created_at   INTEGER NOT NULL,
  UNIQUE (workflow_id, version),
  FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_revision_wf ON workflow_revision(workflow_id, version);

-- workflow_vec:sqlite-vec 向量检索(以前干过类似的事吗)
-- TODO: sqlite-vec 扩展接入后创建虚拟表:
--   CREATE VIRTUAL TABLE workflow_vec USING vec0(
--     revision_id TEXT PRIMARY KEY, embedding FLOAT[384]
--   );

-- ===== 运行(这一次下厨)=====
CREATE TABLE IF NOT EXISTS run (
  id              TEXT PRIMARY KEY,
  revision_id     TEXT NOT NULL,
  project_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending/running/paused/succeeded/failed/aborted
  inputs_json     TEXT,             -- 运行输入(用户填的槽位)
  budget_json     TEXT,             -- 预算(max_model_calls/max_seconds/max_cost/max_rollback_rounds)
  started_at      INTEGER,
  finished_at     INTEGER,
  cost_total      REAL DEFAULT 0,   -- 累计花费 USD
  vcs_branch      TEXT,             -- agent/run_<id>
  vcs_base_commit TEXT,             -- 运行起点
  FOREIGN KEY (revision_id) REFERENCES workflow_revision(id),
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_run_revision ON run(revision_id);
CREATE INDEX IF NOT EXISTS idx_run_status ON run(status);

CREATE TABLE IF NOT EXISTS step_run (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  node_id         TEXT NOT NULL,    -- spec 里的节点 id
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending/running/succeeded/failed/skipped/deprecated
  attempt         INTEGER NOT NULL DEFAULT 0,
  parent_step_id  TEXT,             -- 回溯时的父步骤(分叉结构)
  started_at      INTEGER,
  finished_at     INTEGER,
  input_json      TEXT,
  input_hash      TEXT,             -- 引用解析后计算,用于复用判定
  output_json     TEXT,
  error           TEXT,
  vcs_commit      TEXT,             -- 这一步的 git commit
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_step_id) REFERENCES step_run(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_step_run ON step_run(run_id, node_id);

CREATE TABLE IF NOT EXISTS model_call (
  id                TEXT PRIMARY KEY,
  step_run_id       TEXT,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  modality          TEXT,            -- text/image/audio/...
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms        INTEGER DEFAULT 0,
  cost              REAL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (step_run_id) REFERENCES step_run(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_model_call_step ON model_call(step_run_id);

CREATE TABLE IF NOT EXISTS tool_call (
  id           TEXT PRIMARY KEY,
  step_run_id  TEXT,
  tool         TEXT NOT NULL,
  args_json    TEXT,
  result_json  TEXT,
  exit_code    INTEGER,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (step_run_id) REFERENCES step_run(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS approval (
  id           TEXT PRIMARY KEY,
  step_run_id  TEXT,
  kind         TEXT NOT NULL,       -- confirm / always
  payload_json TEXT,
  decision     TEXT,                -- approved / rejected / pending
  decided_at   INTEGER,
  decided_by   TEXT,
  FOREIGN KEY (step_run_id) REFERENCES step_run(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artifact (
  id         TEXT PRIMARY KEY,
  run_id     TEXT,
  path       TEXT NOT NULL,         -- 文件路径(磁盘上)
  kind       TEXT,                  -- image/video/audio/code/log
  hash       TEXT,
  size       INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artifact_run ON artifact(run_id);

CREATE TABLE IF NOT EXISTS rollback (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  from_step_id TEXT,
  to_node_id   TEXT NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id) ON DELETE CASCADE,
  FOREIGN KEY (from_step_id) REFERENCES step_run(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rollback_run ON rollback(run_id);
`
