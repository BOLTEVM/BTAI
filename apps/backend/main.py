from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os

app = FastAPI(title="AI Talent Agent API")

class TalentProfile(BaseModel):
    id: int
    name: str
    skills: List[str]
    rate: float
    bio: str
    image_url: Optional[str] = None

# Mock database
talent_db = [
    {"id": 1, "name": "Antigravity Architect", "skills": ["Vyper", "FastAPI", "Next.js"], "rate": 150, "bio": "Specialist in agentic AI systems.", "image_url": "/0.png"},
    {"id": 2, "name": "Neon Designer", "skills": ["UI/UX", "Three.js", "Tailwind"], "rate": 120, "bio": "Creates stunning visual experiences.", "image_url": "/BOLTM.jpeg"}
]

@app.get("/")
async def root():
    return {"message": "AI Talent Agent API is active"}

@app.get("/talent", response_model=List[TalentProfile])
async def get_talent():
    return talent_db

@app.get("/talent/{talent_id}", response_model=TalentProfile)
async def get_talent_by_id(talent_id: int):
    talent = next((t for t in talent_db if t["id"] == talent_id), None)
    if not talent:
        raise HTTPException(status_code=404, detail="Talent not found")
    return talent

class ChatMessage(BaseModel):
    message: str

@app.post("/chat")
async def chat(msg: ChatMessage):
    # Simulated AI Agent response logic
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
