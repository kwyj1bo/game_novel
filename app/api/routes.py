import fitz
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from app.services.pdf_extractor import extract_novel_chapters, extract_novel_text

router = APIRouter()


@router.post("/extract-text", response_class=PlainTextResponse)
async def extract_text(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()

    try:
        return extract_novel_text(pdf_bytes)
    except fitz.FileDataError:
        raise HTTPException(status_code=400, detail="Could not open PDF")


@router.post("/extract-chapters")
async def extract_chapters(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()

    try:
        return extract_novel_chapters(pdf_bytes)
    except fitz.FileDataError:
        raise HTTPException(status_code=400, detail="Could not open PDF")
