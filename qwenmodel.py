from io import BytesIO
import json
from openai import OpenAI
import base64
from pdf2image import convert_from_path
import os
from config import FORM_SYSTEM_PROMPT, logger
from dotenv import load_dotenv

# Configure OpenAI client with error handling
load_dotenv()

try:
    client = OpenAI(
        base_url=os.getenv("OPENAI_BASE_URL"),
        api_key=os.getenv("OPENAI_API_KEY"),  # required, but unused
    )
    print(os.getenv("OPENAI_MODEL"))
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {str(e)}")
    raise

def inference(image_base_64, HTML_CONTENT):
    try:
        # Handle list of images like in summary.py
        image_data = []
        for image in image_base_64:
            image_data.append({"type": "image_url", "image_url": {"url": image}})
        
        # Add the HTML content as text
        image_data.append({"type": "text", "text": f"current form schema: {HTML_CONTENT}"})
        
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL"),
            temperature=0.1,
            messages=[
                {"role": "system", "content": FORM_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": image_data,
                },
            ],
        )
        
        print("response", response)
        # Check if response and choices exist
        if not response or not response.choices or len(response.choices) == 0:
            logger.error("Empty response or no choices returned from API")
            raise ValueError("Empty response from AI model")
        
        # Check if message content exists
        if not response.choices[0].message or not response.choices[0].message.content:
            logger.error("No message content in response")
            raise ValueError("No content in AI model response")
        
        raw_content = response.choices[0].message.content
        print("raw_content", raw_content)
        
        # Try to extract JSON from markdown code blocks
        content = raw_content
        if raw_content.startswith("```json"):
            content = raw_content[7:-3].strip()  # Remove ```json and ```
        elif raw_content.startswith("```"):
            content = raw_content[3:-3].strip()   # Remove ``` and ```
        
        logger.info("Successfully received inference response")
        
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # If JSON parsing fails, try to clean the content more aggressively
            logger.warning("Initial JSON parsing failed, attempting cleanup")
            
            # Remove any leading/trailing whitespace and newlines
            cleaned_content = content.strip()
            
            # Try to find JSON object boundaries
            start_idx = cleaned_content.find('{')
            end_idx = cleaned_content.rfind('}')
            
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                json_content = cleaned_content[start_idx:end_idx+1]
                return json.loads(json_content)
            else:
                logger.error(f"Could not extract valid JSON from content: {cleaned_content}")
                raise ValueError("Invalid JSON response from AI model")
                
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse inference response as JSON: {str(e)}")
        logger.error(f"Raw content was: {raw_content if 'raw_content' in locals() else 'Not available'}")
        raise
    except Exception as e:
        logger.error(f"Error during inference: {str(e)}")
        raise

def pdf_to_base64_images(pdf_path, dpi=300, image_format="png"):
    try:
        logger.info(f"Converting PDF to images: {pdf_path}")
        images = convert_from_path(pdf_path, dpi=dpi)
        base64_images_with_prefix = []

        for i, img in enumerate(images):
            try:
                buffered = BytesIO()
                img.save(buffered, format=image_format.upper())
                encoded_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
                data_uri = f"data:image/{image_format.lower()};base64,{encoded_image}"
                base64_images_with_prefix.append(data_uri)
                logger.debug(f"Successfully converted page {i+1} to base64")
            except Exception as e:
                logger.error(f"Error converting page {i+1} to base64: {str(e)}")
                raise

        logger.info(f"Successfully converted {len(base64_images_with_prefix)} pages to base64")
        return base64_images_with_prefix
    except Exception as e:
        logger.error(f"Error converting PDF to images: {str(e)}")
        raise
