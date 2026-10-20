import base64
import json
import logging
import os
import sqlite3
from contextlib import asynccontextmanager, closing
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from auth import issue_nonce, require_wallet_auth, validate_address_for_chain
from x402_server import build_requirements, decode_payment_signature, verify_and_settle


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
        ok, reason = validate_address_for_chain(value)
        if not ok:
            raise ValueError(reason)
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


@app.get("/auth/nonce")
async def auth_nonce():
    """Issue a single-use SIWE nonce for wallet-authenticated writes."""
    return issue_nonce()


@app.get("/talent", response_model=List[TalentProfile])
async def get_talent():
    with closing(get_connection()) as conn:
        rows = conn.execute("SELECT * FROM talents ORDER BY id DESC").fetchall()
    return [row_to_profile(row) for row in rows]


@app.post("/talent", response_model=TalentProfile, status_code=201)
async def create_talent(profile: TalentProfileInput, signer: str = Depends(require_wallet_auth)):
    # You may only register yourself: the signer must own the payout address.
    if signer != profile.receive_address.lower():
        raise HTTPException(status_code=403, detail="Signer must control receive_address")
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


@app.get("/engage/{talent_id}")
async def engage_talent(talent_id: int, payment_signature: Optional[str] = Header(default=None)):
    """
    x402 engagement endpoint.

    Without a PAYMENT-SIGNATURE header: responds 402 with the payment
    requirements (also in the PAYMENT-REQUIRED header, base64 JSON).
    With one: verifies and settles through the facilitator, then returns the
    engagement receipt (agreement id + settlement transaction).
    """
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM talents WHERE id = ?", (talent_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Talent not found")

    talent = dict(row)
    resource = f"/engage/{talent_id}"
    requirements = build_requirements(talent, resource)

    if not payment_signature:
        body = {"x402Version": 2, "accepts": [requirements]}
        return JSONResponse(
            status_code=402,
            content=body,
            headers={"PAYMENT-REQUIRED": base64.b64encode(json.dumps(body).encode()).decode()},
        )

    payload = decode_payment_signature(payment_signature)
    settlement = verify_and_settle(payload, requirements)

    return {
        "status": "engaged",
        "talent": row_to_profile(row),
        "settlement": settlement,
    }


@app.put("/talent/{talent_id}", response_model=TalentProfile)
async def update_talent(talent_id: int, profile: TalentProfileInput, signer: str = Depends(require_wallet_auth)):
    with closing(get_connection()) as conn:
        existing = conn.execute("SELECT receive_address FROM talents WHERE id = ?", (talent_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Talent not found")
        # Only the wallet that controls the registered payout address may edit.
        if signer != existing["receive_address"].lower():
            raise HTTPException(status_code=403, detail="Signer does not control this profile")
        if profile.receive_address.lower() != existing["receive_address"].lower():
            raise HTTPException(status_code=400, detail="receive_address cannot be changed; register a new profile")
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
