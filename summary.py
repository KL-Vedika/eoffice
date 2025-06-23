from io import BytesIO
import json
from openai import OpenAI
import base64
import requests
from pdf2image import convert_from_path

# This part remains the same
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

# --- MODIFICATION START ---

def inference(image_base_64):
    """
    This function is now a generator. It streams the response from the model
    and yields each content chunk as it arrives.
    """
    SYSTEM_PROMPT = """
    you are expert document reader you will be given with the document images and you need extract the every information present in the document. 
    Summarize the document.
    Describe all the images in the document in  detail.
    """
    image_data = []
    for image in image_base_64:
        image_data.append({"type": "image_url", "image_url": {"url": image}})
        
    # The client call now returns a stream (a generator object)
    response_stream = client.chat.completions.create(
        model="gemma3:4b",
        temperature=0.1,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": image_data,
            },
        ],
        stream=True,  # <-- Key change: Enable streaming
    )

    # Loop through the stream and yield the content of each chunk
    for chunk in response_stream:
        # For streaming responses, the content is in chunk.choices[0].delta.content
        content = chunk.choices[0].delta.content
        if content:  # Ensure the content is not None
            yield content

# --- MODIFICATION END ---


# --- MAIN EXECUTION MODIFICATION ---

# Convert the PDF to images
data = pdf_to_base64_images("uploads\Advisory_on_utilisation_of_enahnced_features_of_eOffice.pdf")

if data:
    print("--- Streaming Model Response ---")
    # The 'inference' function now returns a generator.
    # We loop through it to print each piece of the response as it arrives.
    for chunk in inference(data):
        print(chunk, end='', flush=True)
    
    # Print a final newline for clean terminal output
    print()
    print("--- End of Stream ---")