# db.py

# postgres
import os
from sqlalchemy import create_engine, Column, Integer, String, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
from config import logger

try:
    engine = create_engine(os.getenv("DATABASE_URL"))
    Session = sessionmaker(bind=engine)
except Exception as e:
    logger.error(f"Failed to initialize database connection: {str(e)}")
    raise

Base = declarative_base()

def get_db():
    db = Session()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.error(f"Database error occurred: {str(e)}")
        db.rollback()
        raise
    except Exception as e:
        logger.error(f"Unexpected error occurred: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()
