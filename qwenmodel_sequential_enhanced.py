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
    print(f"Enhanced Sequential Model: {os.getenv('OPENAI_MODEL')}")
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {str(e)}")
    raise

def inference_sequential(image_list, form_schema):
    """
    Enhanced sequential processing with comprehensive context:
    - Summary of all previous pages
    - Previous page's detailed JSON
    - Cumulative confidence tracking
    """
    if not image_list:
        return {}

    logger.info(f"Enhanced sequential processing of {len(image_list)} images")

    combined_data = {}
    previous_page_data = {}
    all_pages_summary = []
    confidence_history = []

    for i, image in enumerate(image_list):
        page_num = i + 1
        logger.info(f"Processing page {page_num}/{len(image_list)}")

        # Build enhanced context message
        context_msg = _build_enhanced_context(
            page_num, len(image_list), previous_page_data, 
            all_pages_summary, confidence_history
        )

        try:
            # Process single page with enhanced context
            page_result = _process_page_enhanced(image, form_schema, context_msg, page_num)

            if page_result:
                # Track confidence for this page
                current_confidence = page_result.get("senderConfidence", 0.0)
                confidence_history.append({
                    "page": page_num,
                    "confidence": current_confidence,
                    "reason": page_result.get("senderConfidenceReason", "No reason provided")
                })

                # Create summary for this page
                page_summary = _create_detailed_page_summary(page_result, page_num)
                all_pages_summary.append(page_summary)

                # Intelligent merging with confidence-based decisions
                combined_data = _intelligent_merge_with_history(
                    combined_data, page_result, confidence_history, page_num
                )

                # Store for next iteration
                previous_page_data = page_result
                logger.info(f"[SUCCESS] Page {page_num} completed with confidence: {current_confidence}")

        except Exception as e:
            logger.error(f"[ERROR] Page {page_num} failed: {e}")
            # Add error info to summaries for context
            all_pages_summary.append({
                "page": page_num,
                "status": "error",
                "summary": f"Processing failed: {str(e)[:100]}"
            })
            continue

    # Final validation and cleanup
    final_data = _validate_and_finalize_data(combined_data, confidence_history)
    
    logger.info(f"Enhanced sequential processing completed. Final confidence: {final_data.get('senderConfidence', 'N/A')}")
    return final_data

def _build_enhanced_context(page_num, total_pages, previous_page_data, all_pages_summary, confidence_history):
    """Build comprehensive context with both summary and detailed JSON"""
    
    if page_num == 1:
        return f"Page 1 of {total_pages}. Extract information for the form schema."
    
    # Build context sections
    context_parts = [f"Page {page_num} of {total_pages}."]
    
    # 1. Overall Progress Summary
    if all_pages_summary:
        context_parts.append("\n=== SUMMARY OF ALL PREVIOUS PAGES ===")
        for summary in all_pages_summary:
            if isinstance(summary, dict):
                context_parts.append(f"Page {summary['page']}: {summary['summary']}")
            else:
                context_parts.append(str(summary))
    
    # 2. Confidence Evolution
    if confidence_history:
        context_parts.append("\n=== SENDER CONFIDENCE HISTORY ===")
        for conf in confidence_history[-3:]:  # Last 3 entries
            sender_line = []
            if conf.get("name"):
                sender_line.append(f"name: {conf['name']}")
            if conf.get("designation"):
                sender_line.append(f"designation: {conf['designation']}")
            if conf.get("organisation"):
                sender_line.append(f"organisation: {conf['organisation']}")
            
            sender_str = ", ".join(sender_line) if sender_line else "No sender info"
            context_parts.append(
                f"Page {conf['page']}: Sender: {sender_str} (conf: {conf['confidence']:.1f} - {conf['reason']})"
            )

    # 3. Previous Page Detailed Data
    if previous_page_data:
        prev_json_str = json.dumps(previous_page_data, indent=2)
        context_parts.append(f"\n=== PREVIOUS PAGE STRUCTURED DATA ===")
        context_parts.append("```json")
        context_parts.append(prev_json_str)
        context_parts.append("```")
    
    
    return "\n".join(context_parts)

def _process_page_enhanced(image, form_schema, context, page_num):
    """Process single page with enhanced context and error handling"""
    try:
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL"),
            temperature=0.1,
            max_tokens=4000,  # Increased for complex responses
            messages=[
                {"role": "system", "content": SEQUENTIAL_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image}},
                        {"type": "text", "text": f"FORM SCHEMA TO POPULATE:\n{form_schema}"},
                        {"type": "text", "text": f"CONTEXT:\n{context}"}
                    ],
                },
            ],
        )
        # print("Form schema: ", form_schema)
        # print("Context: ", context)
        # print("Response: ", response)
        
        raw_content = response.choices[0].message.content
        # print("Raw content: ", raw_content)
        logger.debug(f"Page {page_num} raw response: {raw_content[:200]}...")
        
        # Enhanced JSON cleaning
        content = _clean_json_response(raw_content)
        parsed_data = json.loads(content)
        
        # Validate required confidence fields for sender data
        if any(key in parsed_data for key in ['name', 'designation', 'organisation']):
            if 'senderConfidence' not in parsed_data:
                parsed_data['senderConfidence'] = 0.5  # Default medium confidence
                parsed_data['senderConfidenceReason'] = "Confidence not specified by model"
        
        return parsed_data
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error on page {page_num}: {e}")
        logger.error(f"Raw content: {raw_content}")
        raise
    except Exception as e:
        logger.error(f"Processing error on page {page_num}: {e}")
        raise

def _clean_json_response(raw_content):
    """Enhanced JSON cleaning with better error handling"""
    content = raw_content.strip()
    
    # Remove code block markers
    if content.startswith("```json"):
        content = content[7:].strip()
    elif content.startswith("```"):
        content = content[3:].strip()
    
    if content.endswith("```"):
        content = content[:-3].strip()
    
    # Find JSON boundaries if mixed with other text
    json_start = content.find('{')
    json_end = content.rfind('}')
    
    if json_start != -1 and json_end != -1 and json_end > json_start:
        content = content[json_start:json_end + 1]
    
    return content

def _create_detailed_page_summary(data, page_num):
    """Create detailed summary for historical context"""
    if not data:
        return {"page": page_num, "status": "empty", "summary": "No data extracted"}
    
    # Extract key information
    key_info = []
    
    # Sender information
    sender_info = []
    sender_fields = ['name', 'designation', 'organisation']
    for field in sender_fields:
        if field in data and data[field]:
            sender_info.append(f"{field}: {data[field]}")
    
    if sender_info:
        sender_confidence = data.get('senderConfidence', 'unknown')
        key_info.append(f"Sender: {', '.join(sender_info)} (conf: {sender_confidence})")
    
    # Document information
    doc_info = []
    doc_fields = ['letterDate', 'letterRefNo', 'subject', 'category', 'subCategory', 'orgLevel']
    for field in doc_fields:
        if field in data and data[field]:
            doc_info.append(f"{field}: {data[field]}")
    
    if doc_info:
        key_info.append(f"Document: {', '.join(doc_info)}")
    
    # Contact information
    contact_fields = ['mobile', 'phone', 'email', 'address']
    contact_info = [f"{f}: {data[f]}" for f in contact_fields if f in data and data[f]]
    if contact_info:
        key_info.append(f"Contact: {', '.join(contact_info)}")
    
    summary_text = "; ".join(key_info) if key_info else "Basic form data extracted"
    
    return {
        "page": page_num,
        "status": "success",
        "summary": summary_text,
        "sender_confidence": data.get('senderConfidence', 0.0),
        "fields_extracted": len([k for k, v in data.items() if v is not None])
    }

def _intelligent_merge_with_history(combined_data, page_result, confidence_history, current_page):
    """Intelligent merging considering entire confidence history"""
    
    # Start with current page data
    merged_data = page_result.copy()
    
    # Get current confidence
    current_confidence = page_result.get("senderConfidence", 0.0)
    
    # Find best confidence from history
    best_confidence_entry = max(confidence_history, key=lambda x: x["confidence"], default=None)
    
    # Sender-related fields
    sender_fields = [
        "name", "designation", "organisation", "mobile", "email", "address",
        "country", "state", "cityName", "pincode", "phone", "fax",
        "senderConfidence", "senderConfidenceReason"
    ]
    
    # If we have existing combined data with better confidence, preserve it
    if combined_data and best_confidence_entry:
        existing_confidence = combined_data.get("senderConfidence", 0.0)
        
        # Complex decision logic
        should_preserve_existing = (
            existing_confidence > current_confidence and 
            existing_confidence >= 0.8 and  # High confidence threshold
            current_confidence < existing_confidence - 0.2  # Significant gap
        )
        
        if should_preserve_existing:
            logger.info(f"Preserving sender data from previous pages (conf: {existing_confidence:.1f} vs {current_confidence:.1f})")
            for field in sender_fields:
                if field in combined_data and combined_data[field] is not None:
                    merged_data[field] = combined_data[field]
        else:
            # Check for partial improvements
            merged_data = _merge_partial_sender_improvements(merged_data, combined_data, current_confidence, existing_confidence)
    
    # Always merge non-sender fields (taking new values when available)
    for key, value in page_result.items():
        if key not in sender_fields and value is not None:
            merged_data[key] = value
    
    # Fill gaps from previous data
    for key, value in combined_data.items():
        if key not in merged_data or merged_data[key] is None:
            merged_data[key] = value
    
    return merged_data

def _merge_partial_sender_improvements(new_data, existing_data, new_confidence, existing_confidence):
    """Merge sender fields intelligently, allowing partial improvements"""
    
    # If significantly better confidence, take all new data
    if new_confidence > existing_confidence + 0.3:
        return new_data
    
    # If similar confidence, merge best fields
    if abs(new_confidence - existing_confidence) <= 0.2:
        sender_fields = [
            "name", "designation", "organisation", "mobile", "email", "address",
            "country", "state", "cityName", "pincode", "phone", "fax"
        ]
        
        for field in sender_fields:
            # Keep existing if new is empty/null
            if field in existing_data and existing_data[field] is not None:
                if field not in new_data or new_data[field] is None:
                    new_data[field] = existing_data[field]
        
        # Use the higher confidence and combine reasons
        if existing_confidence > new_confidence:
            new_data['senderConfidence'] = existing_confidence
            existing_reason = existing_data.get('senderConfidenceReason', '')
            new_reason = new_data.get('senderConfidenceReason', '')
            new_data['senderConfidenceReason'] = f"{existing_reason}; merged with page data"
    
    return new_data

def _validate_and_finalize_data(data, confidence_history):
    """Final validation and cleanup of extracted data"""
    
    # Ensure all required confidence fields are present
    if any(key in data for key in ['name', 'designation', 'organisation']):
        if 'senderConfidence' not in data:
            # Use the best confidence from history
            best_conf = max(confidence_history, key=lambda x: x["confidence"], default={"confidence": 0.5})
            data['senderConfidence'] = best_conf["confidence"]
            data['senderConfidenceReason'] = "Derived from processing history"
    
    # Clean up null/empty values
    cleaned_data = {}
    for key, value in data.items():
        if value is not None and str(value).strip() not in ["", "null", "None"]:
            cleaned_data[key] = value
        else:
            cleaned_data[key] = None
    
    return cleaned_data

def pdf_to_base64_images(pdf_path, dpi=150):
    """Convert PDF to images with enhanced error handling"""
    try:
        images = convert_from_path(pdf_path, dpi=dpi)
        base64_images = []
        
        for i, img in enumerate(images):
            buffered = BytesIO()
            img.save(buffered, format="PNG")
            encoded = base64.b64encode(buffered.getvalue()).decode("utf-8")
            base64_images.append(f"data:image/png;base64,{encoded}")
            logger.debug(f"Converted page {i+1} to base64")
        
        logger.info(f"Successfully converted {len(base64_images)} pages from PDF")
        return base64_images
        
    except Exception as e:
        logger.error(f"Error converting PDF to images: {str(e)}")
        raise

def process_pdf_sequential_enhanced(pdf_path, form_schema):
    """
    Enhanced workflow to process a PDF sequentially with comprehensive context
    
    Args:
        pdf_path: Path to PDF file
        form_schema: Form schema to populate
        
    Returns:
        Extracted data from all pages with confidence tracking
    """
    try:
        # Convert PDF to images
        logger.info(f"Starting enhanced sequential processing of: {pdf_path}")
        images = pdf_to_base64_images(pdf_path)
        
        if not images:
            raise ValueError("No images extracted from PDF")
        
        # Process with enhanced sequential method
        result = inference_sequential(images, form_schema)
        
        logger.info("Enhanced sequential processing completed successfully")
        return result
        
    except Exception as e:
        logger.error(f"Error in enhanced sequential processing: {str(e)}")
        raise

