from fastapi import FastAPI, HTTPException, Body, File, UploadFile, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
import os
import base64
import tempfile
from pydantic import BaseModel
from typing import Dict, Any, Optional
import uuid
from datetime import datetime
from dotenv import load_dotenv
from qwenmodel import (
                inference,
                pdf_to_base64_images,
            )
#only chnage this line to use the enhanced model
from qwenmodel_sequential_enhanced import (
                inference_sequential,
                pdf_to_base64_images as pdf_to_base64_images_seq,
            )
from summary import (
                inference as summary_inference,
                pdf_to_base64_images as summary_pdf_to_base64_images,
            )
import traceback
from config import logger
import uvicorn



# Load environment variables
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProcessPdfRequest(BaseModel):
    pdfData: str  # Base64 encoded PDF
    formSchema: Dict[str, Any]

# Create uploads directory
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory storage for file metadata (replaces database)
file_storage = {}

# In-memory storage for temporary files (for summarization)
temp_file_storage = {}

@app.get("/")
async def root():
    """Serve the HTML interface"""
    try:
        content = open("form/index.html").read()
        return HTMLResponse(content=content)
    except Exception as e:
        print(f"Error serving root page: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving root page")

@app.post("/process-pdf-direct")
async def process_pdf_direct(request: ProcessPdfRequest):
    """
    Process PDF directly from base64 data without database storage
    """
    try:
        # Decode base64 PDF data
        pdf_bytes = base64.b64decode(request.pdfData)
        
        # Create temporary file
        temp_id = uuid.uuid4().hex[:12]
        temp_filename = f"temp_pdf_{temp_id}.pdf"
        temp_path = os.path.join(tempfile.gettempdir(), temp_filename)
        
        # Write PDF to temporary file
        with open(temp_path, "wb") as f:
            f.write(pdf_bytes)
        
        print(f"Processing PDF: {temp_filename} ({len(pdf_bytes)} bytes)")
        print(f"Form schema fields: {list(request.formSchema.keys())}")
        
        if not os.path.exists(temp_path):
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to create temporary file: {temp_path}"
            )

        try:
            # Ensure qwenmodel and its functions are correctly imported/defined
            base64_images = pdf_to_base64_images(temp_path)
            if base64_images is None:
                raise HTTPException(
                    status_code=500, detail="Failed to convert PDF to images."
                )
            if not base64_images:
                raise HTTPException(
                    status_code=500, detail="PDF is empty or no images could be extracted."
                )

            # Process all pages with AI at once
            try:
                print(f"🔄 Starting AI inference for {len(base64_images)} pages...")
                all_extracted_data = inference(base64_images, HTML_CONTENT=request.formSchema)
                
                if all_extracted_data is None:
                    print("❌ AI inference returned None")
                    all_extracted_data = {}
                elif not isinstance(all_extracted_data, dict):
                    print(f"❌ AI inference returned unexpected type: {type(all_extracted_data)}")
                    all_extracted_data = {}
                
                successful_pages = len(base64_images) if all_extracted_data else 0
                print(f"✅ Successfully processed all {len(base64_images)} pages: {list(all_extracted_data.keys()) if isinstance(all_extracted_data, dict) else 'No data'}")
            except ValueError as e:
                print(f"❌ AI Model Error: {e}")
                all_extracted_data = {}
                successful_pages = 0
            except Exception as e:
                print(f"❌ Error processing PDF pages: {e}")
                traceback.print_exc()
                all_extracted_data = {}
                successful_pages = 0

            if not all_extracted_data and base64_images:
                print(f"⚠️ Warning: No data extracted from any page, though PDF was processed into images.")

            # Store temporary file path for potential summarization
            temp_file_storage[temp_id] = {
                "temp_path": temp_path,
                "temp_filename": temp_filename,
                "created_at": datetime.now()
            }

            print(f"🎯 Extracted data from {temp_filename}: {list(all_extracted_data.keys())}")
            
            return {
                "message": "PDF processed successfully",
                "pages_processed": len(base64_images),
                "successful_pages": successful_pages,
                "fields_extracted": len(all_extracted_data),
                "success": True,
                "temp_id": temp_id,  # Return temp_id for summarization
                **all_extracted_data
            }

        except HTTPException:
            # Store temp file even on HTTP exceptions for potential summarization
            temp_file_storage[temp_id] = {
                "temp_path": temp_path,
                "temp_filename": temp_filename,
                "created_at": datetime.now()
            }
            raise
        except Exception as e:
            # Store temp file even on other exceptions for potential summarization
            temp_file_storage[temp_id] = {
                "temp_path": temp_path,
                "temp_filename": temp_filename,
                "created_at": datetime.now()
            }
            print(f"❌ Unexpected error processing {temp_filename}: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"An unexpected error occurred: {str(e)}"
            )
            
    except Exception as e:
        # Store temp file even on final exceptions for potential summarization
        try:
            if 'temp_path' in locals() and 'temp_id' in locals():
                temp_file_storage[temp_id] = {
                    "temp_path": temp_path,
                    "temp_filename": temp_filename if 'temp_filename' in locals() else f"temp_pdf_{temp_id}.pdf",
                    "created_at": datetime.now()
                }
        except:
            pass
        
        print(f"Error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    original_filename = file.filename
    filename = os.path.basename(original_filename) if original_filename else "unknown.pdf"

    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename provided by client.")

    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        content = await file.read()
        file_size = len(content)

        with open(file_path, "wb") as f:
            f.write(content)
    except IOError:
        raise HTTPException(status_code=500, detail="Could not write file to disk.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error handling file: {str(e)}")

    # Generate document ID
    doc_id = uuid.uuid4().hex[:24]

    file_storage[doc_id] = {
        "doc_id": doc_id,
        "file_name": filename,
        "original_file_name": original_filename,
        "mime_type": file.content_type,
        "size": file_size,
        "saved_on": datetime.now(),
        "file_path": file_path
    }

    print(f"Uploaded: {filename} (ID: {doc_id}, Size: {file_size} bytes)")

    return {
        "message": "File uploaded successfully",
        "documentId": doc_id,
        "filePath": file_path,
    }

@app.get("/efile-api/storage/view/{id}")
async def get_document(id: str = Path(..., description="The ID of the document to retrieve")):
    """Serve uploaded PDF files"""
    print(f"Requested document ID: {id}")

    # Check in-memory storage
    if id not in file_storage:
        raise HTTPException(status_code=404, detail="Document not found")

    file_info = file_storage[id]
    file_path = file_info["file_path"]

    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    raise HTTPException(status_code=404, detail="File not found on disk")

@app.get("/search")
async def search_documents(query: str):
    """Search uploaded documents (in-memory)"""
    search_term = query.lower()
    results = []

    for doc_id, file_info in file_storage.items():
        if (search_term in file_info["file_name"].lower() or 
            search_term in file_info["original_file_name"].lower() or 
            search_term in doc_id.lower()):
            results.append({
                "id": doc_id,
                "name": file_info["file_name"],
                "original_name": file_info["original_file_name"],
            })

    return {"results": results}

@app.post("/summarize-direct")
async def summarize_pdf_direct(request: ProcessPdfRequest):
    """
    Directly summarize PDF from base64 data using summary.py methods
    """
    try:
        # Decode base64 PDF data
        pdf_bytes = base64.b64decode(request.pdfData)
        
        # Create temporary file
        temp_id = uuid.uuid4().hex[:12]
        temp_filename = f"temp_summary_{temp_id}.pdf"
        temp_path = os.path.join(tempfile.gettempdir(), temp_filename)
        
        # Write PDF to temporary file
        with open(temp_path, "wb") as f:
            f.write(pdf_bytes)
        
        print(f"Summarizing PDF directly: {temp_filename} ({len(pdf_bytes)} bytes)")
        
        if not os.path.exists(temp_path):
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to create temporary file for summarization: {temp_path}"
            )
        
        try:
            # Convert PDF to base64 images using summary.py method
            base64_images = summary_pdf_to_base64_images(temp_path)
            if base64_images is None:
                raise HTTPException(
                    status_code=500, detail="Failed to convert PDF to images for summarization."
                )
            if not base64_images:
                raise HTTPException(
                    status_code=500, detail="PDF is empty or no images could be extracted for summarization."
                )
            
            print(f"Converted PDF to {len(base64_images)} images for direct summarization")
            
            # Get streaming summary using summary.py inference method
            # summary_chunks = []
            try:
                # for chunk in summary_inference(base64_images):
                #     summary_chunks.append(chunk)
                
                # full_summary = "".join(summary_chunks)
                full_summary = summary_inference(base64_images)
                
                # Clean up temporary file after successful summarization
                try:
                    os.remove(temp_path)
                    print(f"Cleaned up temporary file: {temp_filename}")
                except:
                    print(f"Could not clean up temporary file: {temp_filename}")
                
                print(f"Successfully summarized PDF directly")
                
                return {
                    "success": True,
                    "message": "PDF summarized successfully",
                    "pages_processed": len(base64_images),
                    "summary": full_summary,
                    "summary_length": len(full_summary)
                }
                
            except Exception as e:
                print(f"Error during AI summarization: {e}")
                # Clean up on error
                try:
                    os.remove(temp_path)
                except:
                    pass
                raise HTTPException(
                    status_code=500, detail=f"Error during AI summarization: {str(e)}"
                )
                
        except HTTPException:
            # Clean up on HTTP exceptions
            try:
                os.remove(temp_path)
            except:
                pass
            raise
        except Exception as e:
            # Clean up on other exceptions
            try:
                os.remove(temp_path)
            except:
                pass
            print(f"Unexpected error during summarization: {e}")
            raise HTTPException(
                status_code=500, detail=f"An unexpected error occurred during summarization: {str(e)}"
            )
            
    except Exception as e:
        print(f"Error in direct PDF summarization: {e}")
        raise HTTPException(status_code=500, detail=f"Error in direct PDF summarization: {str(e)}")

@app.post("/process-pdf")
async def process_pdf_sequential(request: ProcessPdfRequest):
    """Process PDF using sequential page-by-page approach with context carryover"""
    try:
        # Decode base64 PDF data
        try:
            pdf_data = base64.b64decode(request.pdfData)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 PDF data: {str(e)}")

        # Create temporary file
        temp_filename = f"temp_pdf_{uuid.uuid4().hex[:12]}.pdf"
        temp_path = os.path.join(tempfile.gettempdir(), temp_filename)

        try:
            with open(temp_path, "wb") as f:
                f.write(pdf_data)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save PDF: {str(e)}")

        try:
            # Convert PDF to base64 images
            base64_images = pdf_to_base64_images_seq(temp_path)
            if not base64_images:
                raise HTTPException(
                    status_code=500, detail="PDF is empty or no images could be extracted."
                )

            # Process sequentially with context carryover
            logger.info(f"[SEQUENTIAL] Processing {len(base64_images)} pages with context carryover")
            
            extracted_data = inference_sequential(base64_images, request.formSchema)
            
            # Clean up temporary file
            try:
                os.remove(temp_path)
            except:
                pass

            logger.info(f"[SUCCESS] Sequential extraction complete: {list(extracted_data.keys()) if extracted_data else 'No data'}")
            
            return {
                "message": "PDF processed successfully with sequential context",
                "pages_processed": len(base64_images),
                "processing_method": "sequential_with_context",
                "fields_extracted": len(extracted_data),
                "success": True,
                **extracted_data
            }

        except Exception as e:
            # Clean up temporary file on error
            try:
                os.remove(temp_path)
            except:
                pass
            logger.error(f"[ERROR] Sequential processing failed: {e}")
            raise HTTPException(
                status_code=500, detail=f"Sequential processing failed: {str(e)}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in sequential processing: {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "1.0", "storage": len(file_storage), "temp_storage": len(temp_file_storage)}

if __name__ == "__main__":
    print("Starting PDF Form Filler Backend")
    print("Temp directory:", tempfile.gettempdir())
    uvicorn.run("app_no_db_copy:app", host="0.0.0.0", port=8181, reload=True,ssl_keyfile="private.key",ssl_certfile="certificate.crt") 