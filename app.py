from dotenv import load_dotenv

load_dotenv(".env")
from fastapi import Depends, FastAPI, File, UploadFile, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
import os
from pydantic import BaseModel, field_validator
from typing import Dict, Optional, Any, List
from sqlalchemy.orm import Session
from datetime import datetime
from config import logger

# Assuming db.py and models.py are in the same directory or accessible
from db import get_db  # Your database session dependency
from models import PermanentDocument  # Your SQLAlchemy model


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class FormSchemaItem(BaseModel):
    type: str
    required: Optional[bool] = None
    options: Optional[List[str]] = None
    currentValue: Optional[Any] = None

    @field_validator("type")
    def check_type_is_known(cls, value):
        return value


class ProcessPdfRequest(BaseModel):
    documentId: str
    form_schema: Dict[str, FormSchemaItem]
    pageHTML: Optional[str] = None


@app.get("/")
async def root():
    try:
        content = open("form/index.html").read()
        return HTMLResponse(content=content)
    except Exception as e:
        logger.error(f"Error serving root page: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving root page")


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    original_filename_from_client = file.filename
    filename = os.path.basename(
        original_filename_from_client
    )  # Use basename for doc_id and file_name

    if not filename:
        raise HTTPException(
            status_code=400, detail="Invalid filename provided by client."
        )

    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        content = await file.read()
        file_size = len(content)  # Get file size from the read content

        with open(file_path, "wb") as f:
            f.write(content)
    except IOError:
        # If writing to disk fails, we don't proceed to DB
        raise HTTPException(status_code=500, detail="Could not write file to disk.")
    except Exception as e:
        # Catch any other errors during file read/write
        raise HTTPException(status_code=500, detail=f"Error handling file: {str(e)}")

    # --- Database Integration ---
    import uuid

    id = uuid.uuid4().hex[:24]

    try:
        db_document = PermanentDocument(
            doc_id=id,  # Using the sanitized filename as doc_id
            file_name=filename,
            mime_type=file.content_type,
            # num_of_pages will likely be None here, populated later if needed
            original_file_name=original_filename_from_client,  # Store the original name
            base_path=UPLOAD_DIR,  # Store the base directory
            path="",  # Store relative path or full path if preferred (here, just filename)
            saved_on=datetime.now(),  # Or datetime.utcnow() if you prefer UTC
            size=file_size,
            # --- Fields that might need more context or user info ---
            # uploaded_by_delegation_id=None, # Example: Get from authenticated user
            # uploaded_by_post_id=None,       # Example: Get from authenticated user
            # context=None,                   # Example: Get from request or defaults
            # uploaded_by_name=None,          # Example: Get from authenticated user
            # associate_id=None,              # Example: Get from request or defaults
            # module=None,                    # Example: Set based on upload context
            signed=False,  # Default as per your schema
            # application_name=None,          # Example: Set based on client app
            # uploaded_by_session_id=None,    # Example: Get from session if used
            is_encrypted=False,  # Assuming not encrypted on upload by default
            # crypto_provider=None
        )
        db.add(db_document)
        db.commit()
        db.refresh(db_document)
    except Exception as e:
        db.rollback()
        # Optional: If DB save fails, consider deleting the orphaned file from disk
        # try:
        #     if os.path.exists(file_path):
        #         os.remove(file_path)
        # except OSError:
        #     pass # Log this error if deletion fails
        raise HTTPException(
            status_code=500,
            detail=f"Could not save document metadata to database: {str(e)}",
        )

    return {
        "message": "File uploaded successfully and metadata saved.",
        "documentId": db_document.doc_id,
        "filePath": file_path,
    }


@app.get("/document")
async def get_document(
    id: str, db: Session = Depends(get_db)
):  
    doc_metadata = (
        db.query(PermanentDocument).filter(PermanentDocument.doc_id == id).first()
    )

    file_path = os.path.join(doc_metadata.base_path, doc_metadata.path, doc_metadata.file_name)  # Construct path using UPLOAD_DIR


    if os.path.exists(file_path) and os.path.isfile(file_path):
        # Use mime_type from metadata if available and reliable
        # media_type = doc_metadata.mime_type if doc_metadata and doc_metadata.mime_type else None
        return FileResponse(file_path)  # , media_type=media_type)
    raise HTTPException(status_code=404, detail="File not found on disk.")


@app.get("/search")
async def search_documents(query: str, db: Session = Depends(get_db)):
    search_term = f"%{query.lower()}%"
    db_results = (
        db.query(PermanentDocument)
        .filter(
            (PermanentDocument.file_name.ilike(search_term))
            | (PermanentDocument.original_file_name.ilike(search_term))
            | (PermanentDocument.doc_id.ilike(search_term))
        )
        .all()
    )

    results = [
        {
            "id": doc.doc_id,
            "name": doc.file_name,
            "original_name": doc.original_file_name,
        }
        for doc in db_results
    ]
    return {"results": results}


@app.post("/process")
async def process_pdf_endpoint(
    request_data: ProcessPdfRequest = Body(...), db: Session = Depends(get_db)
):
    doc_id = os.path.basename(request_data.documentId)

    # 1. Retrieve document metadata from DB
    db_document = (
        db.query(PermanentDocument).filter(PermanentDocument.doc_id == doc_id).first()
    )
    if not db_document:
        raise HTTPException(
            status_code=404, detail=f"Document metadata not found for ID: {doc_id}"
        )

    # Construct file path from metadata
    file_path = os.path.join(
        db_document.base_path, db_document.path,db_document.file_name
    )  # Assumes base_path and path are set

    print(f"Received process request for document: {db_document.file_name}")

    if request_data.pageHTML:
        print(f"With page HTML (length): {len(request_data.pageHTML)}")
    else:
        print("No page HTML provided with this request.")

    if not (os.path.exists(file_path) and os.path.isfile(file_path)):
        # This case should ideally be rare if metadata implies file existence
        # but good to double check.
        raise HTTPException(
            status_code=404,
            detail=f"File not found on disk: {file_path} (referenced by doc_id: {doc_id})",
        )

    try:
        # Ensure qwenmodel and its functions are correctly imported/defined
        from qwenmodel import (
            inference,
            pdf_to_base64_images,
        )  # Moved import here to avoid top-level if optional

        base64_images = pdf_to_base64_images(file_path)
        if base64_images is None:
            raise HTTPException(
                status_code=500, detail="Failed to convert PDF to images."
            )
        if not base64_images:
            # Potentially update num_of_pages in DB if it's 0
            # db_document.num_of_pages = 0
            # db.commit()
            raise HTTPException(
                status_code=500, detail="PDF is empty or no images could be extracted."
            )

        # Update num_of_pages in the database
        db_document.num_of_pages = len(base64_images)
        db.commit()
        db.refresh(db_document)

        all_pages_data = []
        for i, b64_image in enumerate(base64_images):
            try:
                page_data = inference(b64_image, HTML_CONTENT=request_data.form_schema)
                all_pages_data.append(page_data)
            except Exception as e:
                print(
                    f"Error inferring data for page {i+1} of {db_document.file_name}: {e}"
                )
                all_pages_data.append(
                    {"error": f"Failed to process page {i+1}", "details": str(e)}
                )

        if not all_pages_data and base64_images:
            print(
                f"Warning: No data extracted from any page of {db_document.file_name}, though PDF was processed into images."
            )

        print(f"Extracted data for {db_document.file_name}: {all_pages_data}")
        return {
            "message": "PDF processed successfully",
            "documentId": db_document.doc_id,
            "num_of_pages_processed": db_document.num_of_pages,
            "extracted_data_per_page": all_pages_data,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Unexpected error processing {db_document.file_name}: {e}")
        import traceback

        traceback.print_exc()
        # db.rollback() # Rollback if any commit was pending within this try block
        raise HTTPException(
            status_code=500, detail=f"An unexpected error occurred: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)