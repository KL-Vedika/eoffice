from io import BytesIO
import json
from openai import OpenAI
import base64
from pdf2image import convert_from_path
import os
from config import SYSTEM_PROMPT, logger

# Configure OpenAI client with error handling
try:
    client = OpenAI(
        base_url=os.getenv("OPENAI_BASE_URL"),
        api_key=os.getenv("OPENAI_API_KEY"),  # required, but unused
    )
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {str(e)}")
    raise

def inference(image_base_64, HTML_CONTENT):
    try:
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL"),
            temperature=0.1,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": image_base_64},
                        },
                        {"type": "text", "text": f"current form schema: {HTML_CONTENT}"},
                    ],
                },
            ],
        )
        
        content = response.choices[0].message.content[7:-4]
        logger.info("Successfully received inference response")
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse inference response as JSON: {str(e)}")
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
