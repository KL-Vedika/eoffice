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
    Process each page cumulatively, building upon previous summaries to create
    one final comprehensive summary instead of separate page summaries.
    """
    
    if not image_base_64:
        return "No images provided for summarization."
    
    cumulative_summary = ""
    
    # Process each page cumulatively
    for i, image in enumerate(image_base_64):
        page_num = i + 1
        print(f"Processing page {page_num}/{len(image_base_64)} for summarization...")
        
        try:
            # Create the user message based on whether this is the first page or not
            if page_num == 1:
                # First page - no previous context
                user_content = [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": f"Summarize the content of this document page {page_num}. Focus on the main points, key information, and important details."}
                ]
            else:
                # Subsequent pages - include previous summary as context
                user_content = [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": f"""Previous summary from pages 1-{page_num-1}:
{cumulative_summary}

Now analyze page {page_num} and update/expand the summary above to include the new information from this page. Provide a comprehensive summary that integrates all information from pages 1-{page_num}. Do not create separate sections for each page - instead, create one cohesive summary that flows naturally."""}
                ]
            
            # Get response from the model
            response = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL"),
                temperature=0.1,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            )
            
            # Update cumulative summary with the new response
            new_summary = response.choices[0].message.content
            print(f"New summary: {new_summary}")
            
            if new_summary and new_summary.strip():
                cumulative_summary = new_summary.strip()
                print(f"Updated cumulative summary after page {page_num}: {len(cumulative_summary)} characters")
            else:
                print(f"No meaningful content extracted from page {page_num}")
                if not cumulative_summary:
                    cumulative_summary = f"No meaningful content extracted from page {page_num}."
                
        except Exception as e:
            print(f"Error processing page {page_num}: {e}")
            if not cumulative_summary:
                cumulative_summary = f"Error processing document - {str(e)}"
            continue
    
    # Return the final cumulative summary
    if not cumulative_summary:
        cumulative_summary = "No content could be extracted from the document."
    
    print(f"Final summary length: {len(cumulative_summary)} characters")
    return cumulative_summary


