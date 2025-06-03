from io import BytesIO
import json
from openai import OpenAI
import base64
import requests
from pdf2image import convert_from_path

client = OpenAI(
    base_url="http://100.120.1.23:11434/v1",
    api_key="ollama",  # required, but unused
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


def inference(image_base_64, HTML_CONTENT):
    SYSTEM_PROMPT = """
    you are expert document reader you will be given with the document images and you need extract the every information present in the document. 

    extract strucutre of the information also so that users can understand what is it.
    Make sure to fill the required fields and dont leave them empty.
    """
    response = client.chat.completions.create(
        model="gemma3:12b",
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
                    {"type": "text", "text": f"current page html: {HTML_CONTENT}"},
                ],
            },
        ],
    )
    return response.choices[0].message.content



data = pdf_to_base64_images("uploads/Document Replica.pdf")

s

print(inference(data[0], ))