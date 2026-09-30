CREATE TABLE models (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
  format TEXT DEFAULT 'onnx', size_mb REAL, active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY, goal TEXT NOT NULL, url TEXT,
  model_id INT REFERENCES models(id), status TEXT DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ);
CREATE TABLE frames (
  id SERIAL PRIMARY KEY, session_id INT REFERENCES sessions(id) ON DELETE CASCADE,
  latency_ms REAL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE detections (
  id SERIAL PRIMARY KEY, frame_id INT REFERENCES frames(id) ON DELETE CASCADE,
  label TEXT, text TEXT, x REAL, y REAL, w REAL, h REAL, conf REAL);
CREATE TABLE actions (
  id SERIAL PRIMARY KEY, session_id INT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT, target TEXT, value TEXT, ok BOOLEAN, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX ON frames(session_id); CREATE INDEX ON detections(frame_id); CREATE INDEX ON actions(session_id);
INSERT INTO models(name,version,size_mb,active) VALUES ('uidet-nano-int8','1.0',9.8,true),('uidet-small-fp16','1.0',41,false);
