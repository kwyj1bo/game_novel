from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.build import router as build_router
from app.api.routes import router

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI()
app.include_router(router)
app.include_router(build_router)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/ui", StaticFiles(directory=STATIC_DIR, html=True), name="static")
