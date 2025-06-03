from sqlalchemy import create_engine, Column, String, Integer, BigInteger, DateTime, Boolean, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func # For server-side default timestamps if needed

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

# --- SQLAlchemy Model Definition ---

# Define the base for declarative models
Base = declarative_base()

class PermanentDocument(Base):
    __tablename__ = 'permanent_document'
    __table_args__ = {'schema': 'efile_storage'} # Specify the schema

    # doc_id character varying(255) NOT NULL
    doc_id = Column(String(255), primary_key=True, nullable=False)

    # file_name character varying(255)
    file_name = Column(String(255), nullable=True)

    # mime_type character varying(255)
    mime_type = Column(String(255), nullable=True)

    # num_of_pages integer
    num_of_pages = Column(Integer, nullable=True)

    # original_file_name character varying(255)
    original_file_name = Column(String(255), nullable=True)

    # base_path character varying(255)
    base_path = Column(String(255), nullable=True)

    # path character varying(255)
    path = Column(String(255), nullable=True)

    # saved_on timestamp with time zone
    # If you want the database to automatically set this on creation/update:
    # saved_on = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    # saved_on = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    # As defined, it expects the application to provide the value.
    saved_on = Column(DateTime(timezone=True), nullable=True)

    # size bigint
    size = Column(BigInteger, nullable=True)

    # uploaded_by_delegation_id bigint
    # Consider using ForeignKey if this links to another table:
    # uploaded_by_delegation_id = Column(BigInteger, ForeignKey('efile_storage.delegations.id'), nullable=True)
    uploaded_by_delegation_id = Column(BigInteger, nullable=True)

    # uploaded_by_post_id bigint
    # uploaded_by_post_id = Column(BigInteger, ForeignKey('efile_storage.posts.id'), nullable=True)
    uploaded_by_post_id = Column(BigInteger, nullable=True)

    # context character varying(255)
    context = Column(String(255), nullable=True)

    # uploaded_by_name character varying(255)
    uploaded_by_name = Column(String(255), nullable=True)

    # associate_id character varying(255)
    # associate_id = Column(String(255), ForeignKey('efile_storage.associates.id'), nullable=True)
    associate_id = Column(String(255), nullable=True)

    # module character varying(255)
    module = Column(String(255), nullable=True)

    # signed boolean DEFAULT false
    # server_default handles the DB-level default.
    # `default=False` can be used for Python-side defaults if the value isn't sent.
    signed = Column(Boolean, server_default=text('false'), default=False, nullable=True)
    # If it should absolutely NOT be NULL, and always have a true/false value:
    # signed = Column(Boolean, server_default=text('false'), default=False, nullable=False)
    # Based on your DDL (no NOT NULL for signed), nullable=True is more accurate to the DDL.

    # application_name character varying(100)
    application_name = Column(String(100), nullable=True)

    # uploaded_by_session_id bigint
    # uploaded_by_session_id = Column(BigInteger, ForeignKey('efile_storage.sessions.id'), nullable=True)
    uploaded_by_session_id = Column(BigInteger, nullable=True)

    # is_encrypted boolean
    is_encrypted = Column(Boolean, nullable=True)

    # crypto_provider character varying(255)
    crypto_provider = Column(String(255), nullable=True)

    def __repr__(self):
        return f"<PermanentDocument(doc_id='{self.doc_id}', file_name='{self.file_name}')>"


# --- Pydantic Models (for FastAPI request/response validation) ---

class PermanentDocumentBase(BaseModel):
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    num_of_pages: Optional[int] = None
    original_file_name: Optional[str] = None
    base_path: Optional[str] = None
    path: Optional[str] = None
    saved_on: Optional[datetime] = None
    size: Optional[int] = None # Pydantic uses 'int' for BigInteger for practical purposes
    uploaded_by_delegation_id: Optional[int] = None
    uploaded_by_post_id: Optional[int] = None
    context: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    associate_id: Optional[str] = None
    module: Optional[str] = None
    signed: Optional[bool] = False # Default in Pydantic model too
    application_name: Optional[str] = None
    uploaded_by_session_id: Optional[int] = None
    is_encrypted: Optional[bool] = None
    crypto_provider: Optional[str] = None

class PermanentDocumentCreate(PermanentDocumentBase):
    doc_id: str # doc_id is required for creation if it's not auto-generated
    # Add any other fields that are mandatory on creation
    # e.g., if file_name must be provided:
    # file_name: str

class PermanentDocumentUpdate(PermanentDocumentBase):
    # All fields are optional for update
    pass

class PermanentDocumentRead(PermanentDocumentBase):
    doc_id: str

    # Pydantic V2
    class Config:
        from_attributes = True # Replaces orm_mode = True

    # For Pydantic V1:
    # class Config:
    #     orm_mode = True

# --- Example Usage (Conceptual) ---
if __name__ == '__main__':
    # Replace with your actual database URL
    DATABASE_URL = "postgresql://user:password@host:port/dbname"
    # For SQLite:
    # DATABASE_URL = "sqlite:///./test.db" # Create a local SQLite file

    engine = create_engine(DATABASE_URL)

    # Create the table in the database (if it doesn't exist)
    # In a real app, you'd use Alembic for migrations.
    # Make sure the 'efile_storage' schema exists if using PostgreSQL.
    # For PostgreSQL, you might need to create the schema manually first:
    # from sqlalchemy import DDL, event
    # event.listen(Base.metadata, 'before_create', DDL("CREATE SCHEMA IF NOT EXISTS efile_storage"))
    Base.metadata.create_all(bind=engine)

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Example: Creating a Pydantic model from SQLAlchemy model
    db = SessionLocal()
    try:
        # Dummy data for an example
        new_doc_data = {
            "doc_id": "doc12345",
            "file_name": "report.pdf",
            "mime_type": "application/pdf",
            "num_of_pages": 10,
            "original_file_name": "Annual Report 2023.pdf",
            "base_path": "/mnt/storage/efiles",
            "path": "/2023/07/report.pdf",
            "saved_on": datetime.now(), # Explicitly set, or rely on server_default if configured
            "size": 1024576,
            "uploaded_by_name": "John Doe",
            "module": "REPORTS",
            "application_name": "FinanceApp",
            "is_encrypted": False
        }
        # Validate with Pydantic (optional here, FastAPI does it at endpoints)
        pydantic_create_doc = PermanentDocumentCreate(**new_doc_data)

        # Create SQLAlchemy model instance
        db_doc = PermanentDocument(**pydantic_create_doc.model_dump())
        
        db.add(db_doc)
        db.commit()
        db.refresh(db_doc)
        print(f"Created document: {db_doc.doc_id}")

        # Querying
        retrieved_doc = db.query(PermanentDocument).filter(PermanentDocument.doc_id == "doc12345").first()
        if retrieved_doc:
            print(f"Retrieved: {retrieved_doc.file_name}, Signed: {retrieved_doc.signed}")
            # Convert to Pydantic model for API response
            pydantic_read_doc = PermanentDocumentRead.model_validate(retrieved_doc) # Pydantic V2
            # pydantic_read_doc = PermanentDocumentRead.from_orm(retrieved_doc) # Pydantic V1
            print(f"Pydantic model: {pydantic_read_doc.model_dump_json(indent=2)}")

    except Exception as e:
        print(f"An error occurred: {e}")
        db.rollback()
    finally:
        db.close()