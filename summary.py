from io import BytesIO
import json
import os
from openai import OpenAI
import base64
import requests
from pdf2image import convert_from_path
from dotenv import load_dotenv
from config import SUMMARY_SYSTEM_PROMPT

load_dotenv()

# This part remains the same
client = OpenAI(
        base_url=os.getenv("OPENAI_BASE_URL"),
        api_key=os.getenv("OPENAI_API_KEY"),  # required, but unused
    )


def pdf_to_base64_images(pdf_path, dpi=300, image_format="png"):
    try:
        images = convert_from_path(pdf_path, dpi=dpi)
        base64_images_with_prefix = []

        for img in images:
            buffered = BytesIO()
            img.save(buffered, format=image_format.upper())
            encoded_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
            data_uri = f"data:image/{image_format.lower()};base64,{encoded_image}"
            base64_images_with_prefix.append(data_uri)
        return base64_images_with_prefix
    except Exception as e:
        print(f"Error converting PDF to images: {e}")
        return None

def inference(image_base_64):
    """
    Process each page individually and combine all summaries into a final result.
    Returns the complete combined summary instead of streaming.
    """
    
    if not image_base_64:
        return "No images provided for summarization."
    
    page_summaries = []
    
    # Process each page individually
    for i, image in enumerate(image_base_64):
        page_num = i + 1
        print(f"Processing page {page_num}/{len(image_base_64)} for summarization...")
        
        try:
            # Process single page
            response = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL"),
                temperature=0.1,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": image}},
                            {"type": "text", "text": f"Summarize the content of page {page_num}. Focus on the main points, key information, and important details."}
                        ],
                    },
                ],
                # No streaming - get complete response
            )
            
            # Get the complete content from the response
            page_content = response.choices[0].message.content
            print(f"Page {page_num} content: {page_content[:100]}...")
            
            if page_content and page_content.strip():
                page_summaries.append(f"Page {page_num}: {page_content.strip()}")
            else:
                page_summaries.append(f"Page {page_num}: No meaningful content extracted.")
                
        except Exception as e:
            print(f"Error processing page {page_num}: {e}")
            page_summaries.append(f"Page {page_num}: Error processing page - {str(e)}")
            continue
    
    # Combine all page summaries
    if page_summaries:
        if len(page_summaries) == 1:
            # Single page document
            combined_summary = page_summaries[0].replace("Page 1: ", "")
        else:
            # Multi-page document - create comprehensive summary
            combined_summary = f"""

{chr(10).join(page_summaries)}

"""
    else:
        combined_summary = "No content could be extracted from the document."
    
    print(f"Combined summary length: {len(combined_summary)} characters")
    return combined_summary


