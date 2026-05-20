import logging
import os
import sqlite3
from contextlib import asynccontextmanager, closing
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


DB_PATH = os.getenv("BTAI_DB_PATH", "talent.db")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("BTAI_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

logging.basicConfig(level=os.getenv("BTAI_LOG_LEVEL", "INFO"))
logger = logging.getLogger("btai-api")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with closing(get_connection()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS talents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                skills TEXT,
                rate REAL NOT NULL CHECK(rate >= 0),
                bio TEXT NOT NULL,
                image_url TEXT,
                receive_address TEXT NOT NULL
            )
            """
        )
        conn.commit()
    logger.info("Database initialized at %s", DB_PATH)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="BTAI Talent Agent API", version="1.0.0", lifespan=lifespan)

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
    )


class TalentProfile(BaseModel):
    id: int
    name: str
    role: str
    skills: List[str] = Field(default_factory=list)
    rate: float
    bio: str
    image_url: Optional[str] = None
    receive_address: str


class TalentProfileInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    rate: float = Field(ge=0)
    bio: str = Field(min_length=1, max_length=2000)
    receive_address: str = Field(min_length=42, max_length=42)
    skills: List[str] = Field(default_factory=list, max_length=20)
    image_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("receive_address")
    @classmethod
    def validate_receive_address(cls, value: str) -> str:
        if not value.startswith("0x"):
            raise ValueError("receive_address must be an EVM address")
        int(value[2:], 16)
        return value

    @field_validator("skills")
    @classmethod
    def normalize_skills(cls, value: List[str]) -> List[str]:
        return [skill.strip() for skill in value if skill.strip()]


class ChatMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


def row_to_profile(row: sqlite3.Row) -> TalentProfile:
    skills = row["skills"].split(",") if row["skills"] else []
    return TalentProfile(
        id=row["id"],
        name=row["name"],
        role=row["role"],
        skills=skills,
        rate=row["rate"],
        bio=row["bio"],
        image_url=row["image_url"],
        receive_address=row["receive_address"],
    )


@app.get("/")
async def root():
    return {"status": "ok", "service": "btai-talent-api"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/talent", response_model=List[TalentProfile])
async def get_talent():
    with closing(get_connection()) as conn:
        rows = conn.execute("SELECT * FROM talents ORDER BY id DESC").fetchall()
    return [row_to_profile(row) for row in rows]


@app.post("/talent", response_model=TalentProfile, status_code=201)
async def create_talent(profile: TalentProfileInput):
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO talents (name, role, skills, rate, bio, image_url, receive_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                profile.name,
                profile.role,
                ",".join(profile.skills),
                profile.rate,
                profile.bio,
                profile.image_url,
                profile.receive_address,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM talents WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_profile(row)


@app.get("/talent/{talent_id}", response_model=TalentProfile)
async def get_talent_by_id(talent_id: int):
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM talents WHERE id = ?", (talent_id,)).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Talent not found")

    return row_to_profile(row)


@app.put("/talent/{talent_id}", response_model=TalentProfile)
async def update_talent(talent_id: int, profile: TalentProfileInput):
    with closing(get_connection()) as conn:
        cursor = conn.execute(
            """
            UPDATE talents
            SET name = ?, role = ?, skills = ?, rate = ?, bio = ?, image_url = ?, receive_address = ?
            WHERE id = ?
            """,
            (
                profile.name,
                profile.role,
                ",".join(profile.skills),
                profile.rate,
                profile.bio,
                profile.image_url,
                profile.receive_address,
                talent_id,
            ),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Talent not found")
        conn.commit()
        row = conn.execute("SELECT * FROM talents WHERE id = ?", (talent_id,)).fetchone()

    return row_to_profile(row)


@app.post("/chat")
async def chat(msg: ChatMessage):
    raise HTTPException(
        status_code=503,
        detail="Protocol chat is not configured. Set a production AI provider before enabling this endpoint.",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("BTAI_HOST", "0.0.0.0"),
        port=int(os.getenv("BTAI_PORT", "8000")),
        reload=os.getenv("BTAI_RELOAD", "false").lower() == "true",
    )
