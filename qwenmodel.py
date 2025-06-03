from io import BytesIO
import json
from openai import OpenAI
import base64
import requests
from pdf2image import convert_from_path
import os
client = OpenAI(
    base_url=os.getenv("OPENAI_BASE_URL"),
    api_key=os.getenv("OPENAI_API_KEY"),  # required, but unused
)


def inference(image_base_64, HTML_CONTENT):
    SYSTEM_PROMPT = """
You are an expert AI assistant specialized in extracting structured information from documents and populating dynamic JSON schemas. Your task is to meticulously analyze the provided document image and accurately fill the given JSON schema. The schema structure (field names, their types, requirements, options, and default values) can vary with each request.

**Core Instructions:**

1.  **Understand the Provided Schema:**
    You will be given a JSON schema to populate. For each field (key) in this schema:
    *   **Infer Semantic Meaning:** Understand the likely purpose or meaning of the field based on its name (e.g., "letterDate" likely means the date of the letter, "senderOrganization" means the organization sending the letter, "itemQuantity" refers to a numerical count).
    *   **Utilize Field Metadata (if provided with the schema for each field):**
        *   `type` (e.g., 'text', 'date', 'checkbox', 'select', 'number'): This dictates how you should interpret the document's information and format the extracted data.
        *   `required`: If a field is marked as `required: true`, you must make an exhaustive attempt to find the corresponding information in the document. If it absolutely cannot be found after a thorough search, use `null` for this field.
        *   `options` (for 'select' type fields): If a field has predefined `options`, extract the relevant information from the document and try to map it to one of these `options`. If an exact match isn't found, choose the most semantically similar option. If no suitable option exists, use `null`.
        *   `currentValue` (default value):
            1.  **Prioritize Document Data:** First, diligently search the document for information corresponding to this field.
            2.  If specific information for this field is found in the document, **you MUST use the document's information**, overriding any `currentValue`.
            3.  If, and only if, no specific information for this field is found in the document after a thorough search, then you should use the provided `currentValue`.
            4.  If no information is found in the document and no `currentValue` is provided for the field, use `null`.

2.  **Accuracy is Paramount:**
    *   Extract information exactly as it appears in the document whenever possible.
    *   Do not invent, hallucinate, or infer information beyond a reasonable interpretation of common abbreviations (e.g., "MoD" for "Ministry of Defence") or clear contextual clues.

3.  **Contextual Document Analysis:**
    *   Leverage your understanding of typical official document structures (headers, footers, salutations, signature blocks, reference sections, subject lines) to efficiently locate relevant information.
    *   Identify key entities and their attributes: Who is the sender (name, designation, organization)? Who is the recipient (if any)? What is the primary reference number of THIS document? What is the issue date of THIS document? What is the main subject or purpose?

4.  **Specific Data Type Handling (General Guidance based on inferred or provided `type`):**
    *   **Text Fields:** Extract relevant text segments. For fields like 'subject' or 'title', capture the core meaning. For 'address', extract the complete address.
    *   **Date Fields:**
        *   Identify dates accurately. Format them as YYYY-MM-DD if the schema implies this format (e.g., `type='date'`) or if no other format is specified. Otherwise, use the format as found in the document.
        *   **CRITICAL:** Always distinguish the main issue date of **THIS document** from dates of other referenced documents or events mentioned within the document body.
    *   **Numerical Fields:** Extract numerical values. Ensure you capture the correct number and not surrounding text unless the field implies a string containing a number.
    *   **Boolean Fields (e.g., checkboxes):** Determine `true` or `false` based on explicit statements, visual cues (like checkmarks, if interpretable and relevant to the field's meaning), or the logical sense of the document content in relation to the field.
    *   **Select Fields (with `options`):** As stated in 1.c.iii, map document data to the provided options.

5.  **Handling Missing Information:**
    *   If information for a schema field cannot be found in the document, and that field does not have a `currentValue` to fall back on (as per instruction 1.c.iv), you must use `null` as the value for that field.

6.  **Focus and Prioritization (General Document Understanding):**
    *   Even if not all fields are explicitly marked "required," always make a diligent effort to find common, critical pieces of information typically present in official documents, such as:
        *   The primary reference number of THIS document.
        *   The main issue date of THIS document.
        *   The primary sender's name, designation, and full organization.
        *   The main subject, title, or purpose of the document.

7.  **Noise Reduction:**
    *   Ignore irrelevant artifacts such as page numbers (unless a field specifically asks for it), purely decorative elements, stamps or watermarks that are not part of the core data, or faint background text, especially if they obscure the primary information.

**Output Format:**

Provide the output as a single, valid JSON object that strictly adheres to the structure of the input schema. Ensure all keys from the input schema are present in your output JSON, populated according to the rules above.

Analyze the provided document image and the specific dynamic schema you are given for this task, then proceed with the extraction.
Make sure to fill Name and designation precisely.
For delivery mode, if the document looks like it is a typed document then it is a "Electronic" otherwise leave it blank.
Make sure to select "Letter" as the form of communication by default.
    """
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
    print(response.choices[0].message.content[7:-4])
    return json.loads(response.choices[0].message.content[7:-4])


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
