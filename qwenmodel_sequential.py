from io import BytesIO
import json
from openai import OpenAI
import base64
from pdf2image import convert_from_path
import os
from config import SEQUENTIAL_SYSTEM_PROMPT, logger
from dotenv import load_dotenv

# Configure OpenAI client
load_dotenv()

try:
    client = OpenAI(
        base_url=os.getenv("OPENAI_BASE_URL"),
        api_key=os.getenv("OPENAI_API_KEY"),
    )
    print(f"Sequential Model: {os.getenv('OPENAI_MODEL')}")
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {str(e)}")
    raise

# def inference_sequential(image_list, form_schema):
#     """
#     Process images one by one, passing previous context to next image
#     """
#     if not image_list:
#         return {}
    
#     logger.info(f"Sequential processing of {len(image_list)} images")
    
#     combined_data = {}
#     previous_context = ""
    
#     for i, image in enumerate(image_list):
#         page_num = i + 1
#         logger.info(f"Processing page {page_num}/{len(image_list)}")
        
#         # Build context message
#         if i == 0:
#             context_msg = f"Page 1 of {len(image_list)}. Extract information for the form."
#         else:
#             context_msg = f"""Page {page_num} of {len(image_list)}.

# CONTEXT FROM PREVIOUS PAGES:
# {previous_context}

# Follow the sequential processing instructions in your system prompt to create a complete form using information from all pages processed so far."""
        
#         try:
#             # Process single page
#             page_result = _process_page(image, form_schema, context_msg, page_num)
            
#             if page_result:
#                 combined_data.update(page_result)
#                 # Add to context for next page
#                 summary = _summarize_page(page_result, page_num)
#                 previous_context += f"\nPage {page_num}: {summary}"
#                 logger.info(f"[SUCCESS] Page {page_num} completed")
            
#         except Exception as e:
#             logger.error(f"[ERROR] Page {page_num} failed: {e}")
#             continue
    
#     return combined_data

def inference_sequential(image_list, form_schema):
    """
    Process images one by one, passing only previous page's structured JSON as context
    """
    if not image_list:
        return {}

    logger.info(f"Sequential processing of {len(image_list)} images")

    combined_data = {}
    previous_page_data = {}

    for i, image in enumerate(image_list):
        page_num = i + 1
        logger.info(f"Processing page {page_num}/{len(image_list)}")

        # Build context message with previous JSON only
        if i == 0:
            context_msg = f"Page 1 of {len(image_list)}. Extract information for the form."
        else:
            prev_json_str = json.dumps(previous_page_data, indent=2)
            context_msg = f"""Page {page_num} of {len(image_list)}.

PREVIOUS PAGE DATA:
```json
{prev_json_str}
```

Follow the sequential processing instructions in your system prompt. Use this JSON as prior context.
"""

        try:
            # Process single page
            page_result = _process_page(image, form_schema, context_msg, page_num)

            if page_result:
                # Merge only if new values are more confident or fill missing fields
                combined_data.update(page_result)

                # Re-merge sender details if previous one had higher confidence
                combined_data = _merge_sender_fields_with_confidence(combined_data, previous_page_data)

                # Store for next context
                previous_page_data = page_result
                logger.info(f"[SUCCESS] Page {page_num} completed")

        except Exception as e:
            logger.error(f"[ERROR] Page {page_num} failed: {e}")
            continue

    return combined_data



def _process_page(image, form_schema, context, page_num):
    """Process single page with context"""
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL"),
        temperature=0.1,
        messages=[
            {"role": "system", "content": SEQUENTIAL_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": f"FORM SCHEMA TO POPULATE:\n{form_schema}"},
                    {"type": "text", "text": f"PAGE CONTEXT:\n{context}"}
                ],
            },
        ],
    )
    print(f"Response: {response}")
    print(f"Context: {context}")
    raw_content = response.choices[0].message.content
    print(f"Raw content: {raw_content}")
    # Clean JSON from response
    content = raw_content
    if content.startswith("```json"):
        content = content[7:-3].strip()
    elif content.startswith("```"):
        content = content[3:-3].strip()
    
    return json.loads(content)

def _summarize_page(data, page_num):
    """Create summary of extracted data with actual values"""
    if not data:
        return "No meaningful data extracted"
    
    # Extract key information for context
    summary_fields = []
    important_fields = [
        'name', 'designation', 'organisation', 'mobile', 'email', 'address', 
        'country', 'state', 'cityName', 'pincode', 'phone', 'fax', 
        'category', 'subCategory', 'subject', 'sender', 'letterDate', 
        'letterRefNo', 'receivedDate'
    ]
    
    # First, add important fields if they have values
    for field in important_fields:
        if field in data and data[field] is not None and str(data[field]).strip() not in ["", "null"]:
            value = str(data[field])  # Truncate long values
            summary_fields.append(f"{field}: {value}")
    
    # Then add other non-null fields (up to 15 total)
    other_fields = []
    for k, v in data.items():
        if k not in important_fields and v is not None and str(v).strip() not in ["", "null"]:
            value = str(v)
            other_fields.append(f"{k}: {value}")
    
    # Combine important and other fields
    all_fields = summary_fields + other_fields[:max(0, 15 - len(summary_fields))]
    
    if all_fields:
        return "; ".join(all_fields)
    else:
        return "No meaningful data extracted"
    
def _merge_sender_fields_with_confidence(current_data, previous_data):
    """Retain sender-related fields from previous page if they have higher confidence"""
    sender_keys = [
        "name", "designation", "organisation", "mobile", "email", "address",
        "country", "state", "cityName", "pincode", "phone", "fax",
        "senderConfidence", "senderConfidenceReason"
    ]
    new_conf = current_data.get("senderConfidence", 0.0)
    old_conf = previous_data.get("senderConfidence", 0.0)

    if old_conf > new_conf:
        for key in sender_keys:
            if key in previous_data:
                current_data[key] = previous_data[key]

    return current_data

def pdf_to_base64_images(pdf_path, dpi=150):
    """Convert PDF to images"""
    images = convert_from_path(pdf_path, dpi=dpi)
    base64_images = []
    
    for img in images:
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        encoded = base64.b64encode(buffered.getvalue()).decode("utf-8")
        base64_images.append(f"data:image/png;base64,{encoded}")
    
    return base64_images

# Example usage function
def process_pdf_sequential(pdf_path, form_schema):
    """
    Complete workflow to process a PDF sequentially
    
    Args:
        pdf_path: Path to PDF file
        form_schema: Form schema to populate
        
    Returns:
        Extracted data from all pages combined
    """
    try:
        # Convert PDF to images
        images = pdf_to_base64_images(pdf_path)
        
        if not images:
            raise ValueError("No images extracted from PDF")
        
        # Process sequentially
        result = inference_sequential(images, form_schema)
        
        return result
        
    except Exception as e:
        logger.error(f"Error in process_pdf_sequential: {str(e)}")
        raise 