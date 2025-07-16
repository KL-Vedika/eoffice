import os
import sys
from mistralai import Mistral
from config import FORM_SYSTEM_PROMPT
from dotenv import load_dotenv

load_dotenv()

# Comprehensive system prompt for detailed form extraction
COMPREHENSIVE_FORM_SYSTEM_PROMPT = """
You are an expert AI assistant specialized in extracting comprehensive structured information from official documents, letters, and communications. Your task is to meticulously analyze the provided document and accurately extract ALL available information according to the specified JSON schema.

**Core Extraction Principles:**

1. **Sender Information Extraction Strategy:**
   - **Primary Source**: Extract sender name and designation from signature block area
   - **Contact Information Sources**: Look for sender's contact details in multiple locations:
     * Signature block and immediate vicinity
     * Document footer (letterhead contact information)
     * Header/letterhead (if clearly associated with sender's organization)
     * Contact details section at bottom of document
     * Any section clearly labeled as sender's contact information
   - **Validation**: Ensure contact details logically belong to the identified sender/organization
   - **Do NOT extract**: Recipient information, third-party contacts, or unrelated contact details

2. **Sender Contact Details Extraction:**
   - **Phone/Mobile**: Extract from footer, letterhead, signature area, or contact sections
   - **Email**: Look in signature, footer, letterhead, or contact information areas
   - **Address**: Extract complete address from footer, letterhead, signature area, or contact sections
   - **Fax**: Often found in footer or contact information sections
   - **Organization Details**: Cross-reference with letterhead, footer, and signature information

3. **Document Metadata Extraction:**
   - **diaryDate**: Date when document was registered/logged (if mentioned)
   - **letterDate**: The actual date of the letter/document (usually at top or in header)
   - **letterRefNo**: Reference number of THIS document (not referenced documents)
   - **receivedDate**: Date when document was received (if different from letter date)
   - **deliveryMode**: How document was delivered (Electronic, Post, Hand, Courier, etc.)

4. **Communication Classification:**
   - **comms-form-input**: Type of communication (Letter, Memo, Note, Application, etc.)
   - **language-input**: Language of the document (English, Hindi, etc.)
   - **category**: Main category/classification of the document
   - **subCategory**: Sub-classification within the main category
   - **subject**: Main subject/title/purpose of the document

5. **Address and Location Extraction:**
   - **address**: Complete address from any reliable source (footer, letterhead, signature)
   - **country**: Extract if mentioned, default to "India" for Indian government documents
   - **state**: State/province from address information
   - **cityName**: City name from address or contact information
   - **pincode**: PIN/ZIP code from address sections

6. **Confidence Assessment:**
   - **sender**: Same as name field
   - **senderConfidence**: Rate confidence (0.0-1.0) in sender identification
   - **senderConfidenceReason**: Explain why confidence is high/low

7. **Information Prioritization:**
   - If multiple contact details exist, prioritize those closest to sender's signature
   - Cross-reference contact information with organization name for consistency
   - Use letterhead/footer contact info if it matches sender's organization
   - Distinguish between sender's personal contact and organizational contact

8. **Boolean and Special Fields:**
   - **addToAddressBook**: Set to false unless explicitly mentioned
   - **acknowledgement**: true if acknowledgement is requested/mentioned
   - **receiptNature**: "E" for Electronic, "P" for Physical based on delivery mode

**Data Type Handling:**
- **Text fields**: Extract exactly as written, clean formatting
- **Date fields**: Format as YYYY-MM-DD when possible
- **Boolean fields**: true/false based on explicit mentions or logical inference
- **Null handling**: Use null for missing information, not empty strings

**Quality Standards:**
- **Comprehensive Search**: Look throughout the document for sender contact information
- **Logical Association**: Ensure extracted contact details belong to the identified sender
- **Accuracy Priority**: Don't guess, but do extract available information from appropriate sources
- **Source Documentation**: In confidence reason, mention where information was found

**Contact Information Extraction Examples:**
- Phone in footer: "Tel: +91-11-23456789" → Extract as phone
- Email in letterhead: "director@ministry.gov.in" → Extract as email  
- Address in footer: "Ministry Building, New Delhi - 110001" → Extract components
- Mobile in signature: "Mob: 9876543210" → Extract as mobile

**Output Requirements:**
Provide ONLY a valid JSON object with ALL schema fields included. Use exact field names and appropriate data types.

Example confidence assessment:
- High confidence (0.8-1.0): Clear name, designation, and organization in signature
- Medium confidence (0.5-0.7): Name clear but limited other details
- Low confidence (0.0-0.4): Unclear or inferred information if no explicit signature block is present

Search for confidence >=0.8 and then only input sender details in the JSON object. If confidence is below 0.8, set sender-related fields to null.
"""

def test_mistral_with_form_extraction():
    """
    Test the Mistral AI model for comprehensive form data extraction
    """
    try:
        # Retrieve the API key from environment variables
        api_key = os.environ.get("MISTRAL_API_KEY")
        
        if not api_key:
            print("Error: MISTRAL_API_KEY environment variable not set")
            return
        
        # Specify model
        model = "pixtral-12b-2409"  #"mistral-small-latest"
        
        # Initialize the Mistral client
        client = Mistral(api_key=api_key)
        
        # Path to local PDF file
        pdf_path = "uploads/sample.pdf"
        
        if not os.path.exists(pdf_path):
            print(f"Error: PDF file not found at {pdf_path}")
            return
        
        print(f"Uploading PDF file for form extraction: {pdf_path}")
        
        # Upload local document and retrieve the signed URL
        uploaded_pdf = client.files.upload(
            file={
                "file_name": "sample.pdf",
                "content": open(pdf_path, "rb"),
            },
            purpose="ocr"
        )
        
        # Get signed URL for the uploaded file
        signed_url = client.files.get_signed_url(file_id=uploaded_pdf.id)
        # Save the signed URL to a local file for inspection
        with open("signed_url.txt", "w") as f:
            f.write(signed_url.url)
        print("Signed URL saved to signed_url.txt")

        
        # Comprehensive JSON schema for form extraction
        comprehensive_schema = {
            "diaryDate": {"type": "date", "required": False},
            "name": {"type": "text", "required": True},
            "designation": {"type": "text", "required": False},
            "organisation": {"type": "text", "required": False},
            "mobile": {"type": "text", "required": False},
            "email": {"type": "text", "required": False},
            "address": {"type": "text", "required": False},
            "country": {"type": "text", "required": False, "default": "India"},
            "state": {"type": "text", "required": False},
            "cityName": {"type": "text", "required": False},
            "pincode": {"type": "text", "required": False},
            "phone": {"type": "text", "required": False},
            "fax": {"type": "text", "required": False},
            "comms-form-input": {"type": "text", "required": False, "default": "Letter"},
            "language-input": {"type": "text", "required": False, "default": "English"},
            "receivedDate": {"type": "date", "required": False},
            "letterDate": {"type": "date", "required": False},
            "letterRefNo": {"type": "text", "required": False},
            "deliveryMode": {"type": "text", "required": False, "default": "Electronic"},
            "deliveryModeNo": {"type": "text", "required": False},
            "vipType": {"type": "text", "required": False},
            "addToAddressBook": {"type": "boolean", "required": False, "default": False},
            "orgLevel": {"type": "text", "required": False},
            "category": {"type": "text", "required": False},
            "subCategory": {"type": "text", "required": False},
            "subject": {"type": "text", "required": False},
            "remarks": {"type": "text", "required": False},
            "acknowledgement": {"type": "boolean", "required": False, "default": False},
            "receiptNature": {"type": "text", "required": False, "default": "E"},
            "sender": {"type": "text", "required": True},
            "senderConfidence": {"type": "number", "required": True},
            "senderConfidenceReason": {"type": "text", "required": True}
        }
        
        # Define the messages for comprehensive form extraction
        messages = [
            {
                "role": "system",
                "content": COMPREHENSIVE_FORM_SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"Extract comprehensive structured information from this document according to this JSON schema: {comprehensive_schema}. Pay special attention to sender details from signature block, document dates, reference numbers, and provide confidence assessment for sender identification."
                    },
                    {
                        "type": "document_url",
                        "document_url": signed_url.url
                    }
                ]
            }
        ]
        
        print("\nSending comprehensive form extraction request to Mistral AI...")
        
        # Get the chat response
        chat_response = client.chat.complete(
            model=model,
            messages=messages
        )
        
        # Print the content of the response
        print("\n" + "="*60)
        print("COMPREHENSIVE FORM EXTRACTION RESPONSE:")
        print("="*60)
        print(chat_response.choices[0].message.content)
        print("="*60)
        
    except Exception as e:
        print(f"Error occurred in form extraction: {str(e)}")
        return

if __name__ == "__main__":
    print("Testing Mistral AI Model - Comprehensive Form Extraction")
    print("="*60)
    
    # Check if API key is available
    if not os.environ.get("MISTRAL_API_KEY"):
        print("Please set the MISTRAL_API_KEY environment variable before running this test.")
        print("Example: export MISTRAL_API_KEY='your_api_key_here'")
        sys.exit(1)
    
    # Comprehensive form data extraction test
    test_mistral_with_form_extraction()
    
    print("\nTest completed!") 