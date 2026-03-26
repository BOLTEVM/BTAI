from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
import sqlite3
from contextlib import asynccontextmanager

# Database Setup
DB_PATH = "talent.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS talents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            skills TEXT, -- Comma separated
            rate REAL NOT NULL,
            bio TEXT,
            image_url TEXT,
            receive_address TEXT
        )
    ''')
    
    # Seed data if empty
    cursor.execute("SELECT COUNT(*) FROM talents")
    if cursor.fetchone()[0] == 0:
        talents = [
            ("BTAIZERO", "AI Systems Engineer", "Vyper,FastAPI,Next.js", 150.0, "Master of agentic workflows and smart contract integration.", "/0logov3.png", "0xf0198a8eaaf8d9c9527d628afa0beabe674169a5"),
            ("Neon Designer", "Creative Director", "UI/UX,Three.js,Tailwind", 120.0, "Specializing in high-end digital aesthetics and immersive UI.", "/BOLTM.jpeg", "0xf0198a8eaaf8d9c9527d628afa0beabe674169a5")
        ]
        cursor.executemany("INSERT INTO talents (name, role, skills, rate, bio, image_url, receive_address) VALUES (?, ?, ?, ?, ?, ?, ?)", talents)
    
    conn.commit()
    conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="AI Talent Agent API", lifespan=lifespan)

class TalentProfile(BaseModel):
    id: int
    name: str
    role: str
    skills: List[str]
    rate: float
    bio: str
    image_url: Optional[str] = None
    receive_address: Optional[str] = None

class CreateTalentProfile(BaseModel):
    name: str
    role: str
    rate: float
    bio: str
    receive_address: str

@app.get("/")
async def root():
    return {"message": "AI Talent Agent API is active"}

@app.get("/talent", response_model=List[TalentProfile])
async def get_talent():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM talents")
    rows = cursor.fetchall()
    
    talents = []
    for row in rows:
        talents.append({
            "id": row["id"],
            "name": row["name"],
            "role": row["role"],
            "skills": row["skills"].split(",") if row["skills"] else [],
            "rate": row["rate"],
            "bio": row["bio"],
            "image_url": row["image_url"],
            "receive_address": row["receive_address"]
        })
    
    conn.close()
    return talents

@app.post("/talent", response_model=TalentProfile)
async def create_talent(profile: CreateTalentProfile):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO talents (name, role, rate, bio, receive_address, image_url) VALUES (?, ?, ?, ?, ?, ?)",
        (profile.name, profile.role, profile.rate, profile.bio, profile.receive_address, "/0logov3.png")
    )
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {**profile.dict(), "id": new_id, "skills": [], "image_url": "/0logov3.png"}

@app.get("/talent/{talent_id}", response_model=TalentProfile)
async def get_talent_by_id(talent_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM talents WHERE id = ?", (talent_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Talent not found")
    
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "skills": row["skills"].split(",") if row["skills"] else [],
        "rate": row["rate"],
        "bio": row["bio"],
        "image_url": row["image_url"],
        "receive_address": row["receive_address"]
    }

class ChatMessage(BaseModel):
    message: str

@app.post("/chat")
async def chat(msg: ChatMessage):
    # Simulated AI Agent response logic - could be enhanced with LLM later
    query = msg.message.lower()
    if "contract" in query or "vyper" in query:
        response = "I can help you deploy or manage your Vyper smart contracts. Which talent would you like to hire?"
    elif "talent" in query or "hire" in query:
        response = "We have top-tier AI Architects and Designers available. Check the dashboard to initiate a contract."
    else:
        response = "I am BTAI, your AI Talent Agent. I can help you find talent and manage secure blockchain agreements."
    
    return {"reply": response}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
