import os
import psycopg2, psycopg2.extras
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="SightLite API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def q(sql, args=(), one=False):
    con = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with con, con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
            c.execute(sql, args)
            if c.description:
                return c.fetchone() if one else c.fetchall()
    finally:
        con.close()


class SessionIn(BaseModel):
    goal: str
    url: Optional[str] = None

class Det(BaseModel):
    label: str
    text: Optional[str] = ""
    x: float = 0; y: float = 0; w: float = 0; h: float = 0; conf: float = 1

class FrameIn(BaseModel):
    latency_ms: float
    detections: List[Det] = []

class ActionIn(BaseModel):
    type: str
    target: Optional[str] = ""
    value: Optional[str] = ""
    ok: bool = True

class EndIn(BaseModel):
    status: str = "success"


@app.get("/health")
def health():
    return {"ok": True}

@app.post("/sessions")
def create_session(s: SessionIn):
    return q("INSERT INTO sessions(goal,url,model_id) VALUES(%s,%s,(SELECT id FROM models WHERE active LIMIT 1)) RETURNING id",
             (s.goal, s.url), one=True)

@app.post("/sessions/{sid}/frames")
def add_frame(sid: int, f: FrameIn):
    fid = q("INSERT INTO frames(session_id,latency_ms) VALUES(%s,%s) RETURNING id", (sid, f.latency_ms), one=True)["id"]
    for d in f.detections:
        q("INSERT INTO detections(frame_id,label,text,x,y,w,h,conf) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
          (fid, d.label, d.text, d.x, d.y, d.w, d.h, d.conf))
    return {"id": fid}

@app.post("/sessions/{sid}/actions")
def add_action(sid: int, a: ActionIn):
    q("INSERT INTO actions(session_id,type,target,value,ok) VALUES(%s,%s,%s,%s,%s)", (sid, a.type, a.target, a.value, a.ok))
    return {"ok": True}

@app.post("/sessions/{sid}/end")
def end_session(sid: int, e: EndIn):
    q("UPDATE sessions SET status=%s, ended_at=now() WHERE id=%s", (e.status, sid))
    return {"ok": True}

@app.get("/sessions")
def sessions():
    return q("""SELECT s.id,s.goal,s.url,s.status,s.started_at,
                (SELECT count(*) FROM frames f WHERE f.session_id=s.id)::int AS frames,
                (SELECT round(avg(latency_ms)::numeric,1)::float FROM frames f WHERE f.session_id=s.id) AS latency
                FROM sessions s ORDER BY s.id DESC LIMIT 50""")

@app.get("/sessions/{sid}")
def session(sid: int):
    s = q("SELECT * FROM sessions WHERE id=%s", (sid,), one=True)
    if not s:
        raise HTTPException(404, "not found")
    s["actions"] = q("SELECT type,target,value,ok,created_at FROM actions WHERE session_id=%s ORDER BY id", (sid,))
    return s

@app.get("/stats")
def stats():
    return q("""SELECT (SELECT count(*) FROM sessions)::int AS sessions,
                (SELECT count(*) FROM frames)::int AS frames,
                (SELECT coalesce(round(avg(latency_ms)::numeric,1),0)::float FROM frames) AS avg_latency,
                (SELECT coalesce(round(100.0*count(*) FILTER (WHERE status='success')/nullif(count(*) FILTER (WHERE status<>'running'),0),1),0)::float FROM sessions) AS success_rate""", one=True)

@app.get("/models")
def models():
    return q("SELECT * FROM models ORDER BY id")

@app.post("/models/{mid}/activate")
def activate(mid: int):
    q("UPDATE models SET active=(id=%s)", (mid,))
    return {"ok": True}
