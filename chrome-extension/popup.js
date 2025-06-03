// popup.js
document.addEventListener('DOMContentLoaded', function () {
  const fillFormButton = document.getElementById('fillFormButton');
  const statusElement = document.getElementById('status');

  const API_ENDPOINT = 'http://localhost:8000/process';

  // Function to be injected into the page to get its details
  function getPageDetailsAndSchema() {
    try {
      const docIdElement = document.getElementById('documentIdDisplay');
      const docIdSpan = docIdElement ? docIdElement.querySelector('span') : null;
      const documentId = docIdSpan ? docIdSpan.textContent.trim() : null;

      const formSchema = {};
      const eofficeForm = document.getElementById('eofficeForm');
      if (eofficeForm) {
        Array.from(eofficeForm.elements).forEach(element => {
          if (element.id) { // Only process elements with an ID
            const tagName = element.tagName.toLowerCase();
            let schemaEntry = {}; // Initialize schema entry for this element

            // Common properties
            schemaEntry.type = tagName; // Default type is the tag name
            schemaEntry.required = element.required; // Check if the field is mandatory

            // Get current value
            let currentValue = null;
            if (tagName === 'input') {
              schemaEntry.type = element.type.toLowerCase(); // More specific type for inputs
              if (element.type === 'checkbox' || element.type === 'radio') {
                currentValue = element.checked;
              } else {
                currentValue = element.value;
              }
            } else if (tagName === 'select') {
              currentValue = element.value;
              // Get options for select
              const optionValues = [];
              for (let i = 0; i < element.options.length; i++) {
                optionValues.push(element.options[i].value);
              }
              schemaEntry.options = optionValues;
            } else if (tagName === 'textarea') {
              currentValue = element.value;
            }
            // Add other element types if needed (e.g., custom components)

            // Add currentValue to schema if it's not null or empty string (for text-like inputs)
            // For checkboxes/radios, always include the boolean 'checked' status.
            if (currentValue !== null) {
                 if (typeof currentValue === 'string' && currentValue.trim() !== '') {
                    schemaEntry.currentValue = currentValue;
                 } else if (typeof currentValue === 'boolean') {
                    schemaEntry.currentValue = currentValue;
                 } else if (typeof currentValue === 'number') { // In case input type="number"
                    schemaEntry.currentValue = currentValue;
                 }
                 // If currentValue is an empty string for a text field, and you still want to send it,
                 // you can adjust the condition above. For now, only non-empty strings or booleans are sent.
            }

            formSchema[element.id] = schemaEntry;
          }
        });
      } else {
        console.warn('Extension: Form with ID "eofficeForm" not found on page.');
      }

      const pageHTML = document.documentElement.outerHTML;

      if (!documentId) {
        console.warn('Extension: Document ID not found on the page (expected in #documentIdDisplay span).');
      }

      return { success: true, documentId, formSchema, pageHTML, error: null };
    } catch (e) {
      console.error("Extension: Error getting page details in content script:", e);
      return { success: false, documentId: null, formSchema: {}, pageHTML: null, error: e.message };
    }
  }


  // fillPageForm function remains the same as in the previous version
  function fillPageForm(apiData) {
    let fieldsFilledCount = 0;
    let fieldsNotFound = [];
    let errorsEncountered = [];

    console.log("Data received in content script for filling:", apiData);

    if (!apiData || typeof apiData !== 'object') {
      console.error("Received invalid data for form filling:", apiData);
      return { success: false, fieldsFilled: 0, message: 'Received invalid data for form filling.' };
    }

    for (const key in apiData) {
      if (Object.hasOwnProperty.call(apiData, key)) {
        const value = apiData[key];
        let element = null;

        try {
          element = document.querySelector(`[name="${key}"]`);
          if (!element) {
            element = document.getElementById(key);
          }

          if (element) {
            if (element.type === 'checkbox') {
              element.checked = (value === true || String(value).toLowerCase() === 'true' || value === 1);
            } else if (element.type === 'radio') {
              const radioToSelect = document.querySelector(`input[type="radio"][name="${key}"][value="${value}"]`);
              if (radioToSelect) {
                radioToSelect.checked = true;
              } else {
                 if (element.getAttribute('name') === key && element.value === value){
                    element.checked = true;
                 } else if (element.id === key && (value === true || String(value).toLowerCase() === 'true')) {
                    element.checked = true;
                 }
                 else {
                    console.warn(`Radio button with name "${key}" and value "${value}" not found.`);
                    fieldsNotFound.push(`${key} (radio value: "${value}")`);
                    continue;
                 }
              }
            } else if (element.tagName === 'SELECT') {
              let optionFound = false;
              for (let i = 0; i < element.options.length; i++) {
                if (element.options[i].value == value) { // Use == for potential type coercion
                  element.value = value;
                  optionFound = true;
                  break;
                }
              }
              if (!optionFound) {
                console.warn(`Select element with name/id "${key}" does not have option with value "${value}".`);
                fieldsNotFound.push(`${key} (select value: "${value}")`);
                continue; // Skip incrementing and event dispatch
              }
            } else {
              element.value = value;
            }

            try {
              element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            } catch (eventError) {
              console.warn(`Failed to dispatch events for element "${key}":`, eventError);
            }
            fieldsFilledCount++;
          } else {
            console.warn(`Element with name or ID "${key}" not found on the page.`);
            fieldsNotFound.push(key);
          }
        } catch (e) {
          console.error(`Error processing field "${key}":`, e);
          errorsEncountered.push(`${key}: ${e.message}`);
        }
      }
    }

    let message = `Form filling complete. ${fieldsFilledCount} fields populated.`;
    let successStatus = true;

    if (fieldsNotFound.length > 0) {
      message += ` Could not find elements for: ${fieldsNotFound.join(', ')}.`;
    }
    if (errorsEncountered.length > 0) {
      message += ` Errors encountered for: ${errorsEncountered.join('; ')}.`;
      successStatus = false;
    }

    return {
      success: successStatus,
      fieldsFilled: fieldsFilledCount,
      message: message,
      fieldsNotFound: fieldsNotFound,
      errorsEncountered: errorsEncountered
    };
  }


  // --- Event Listener for the Button ---
  fillFormButton.addEventListener('click', async () => {
    statusElement.textContent = 'Getting page details...';
    statusElement.style.color = 'black';

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      statusElement.textContent = 'Could not find active tab.';
      statusElement.style.color = 'red';
      return;
    }

    let pageDetails;
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: getPageDetailsAndSchema
      });

      if (injectionResults && injectionResults.length > 0 && injectionResults[0].result) {
        pageDetails = injectionResults[0].result;
        if (!pageDetails.success) {
            throw new Error(`Failed to get page details: ${pageDetails.error}`);
        }
        if (!pageDetails.documentId) {
          statusElement.textContent = 'Document ID not found on the page. Cannot proceed.';
          statusElement.style.color = 'red';
          return;
        }
        if (!pageDetails.pageHTML) {
             throw new Error('Failed to retrieve page HTML from content script.');
        }
        console.log('Page details retrieved:', {
            documentId: pageDetails.documentId,
            schema: pageDetails.formSchema, // Log the schema to see the structure
            htmlLength: pageDetails.pageHTML.length
        });
      } else {
        throw new Error('Failed to retrieve page details or result was empty.');
      }
    } catch (e) {
      console.error('Error getting page details:', e);
      statusElement.textContent = `Error getting page details: ${e.message}`;
      statusElement.style.color = 'red';
      return;
    }

    statusElement.textContent = 'Sending data to API...';
    statusElement.style.color = 'black';

    const payload = {
      documentId: pageDetails.documentId,
      form_schema: pageDetails.formSchema,
      pageHTML: pageDetails.pageHTML
    };

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorDetail = `Status: ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.json();
          if (errorBody && errorBody.detail) errorDetail += `. Details: ${errorBody.detail}`;
          else {
             const textBody = await response.text();
             if(textBody) errorDetail += `. Details: ${textBody}`;
          }
        } catch (e) {
          console.warn("Could not read detailed error response body:", e);
          const textBody = await response.text().catch(() => "");
          if(textBody) errorDetail += `. Details: ${textBody}`;
        }
        throw new Error(`API Error: ${errorDetail}`);
      }

      const apiResponse = await response.json();
      console.log("API responded with data:", apiResponse);

      let combinedData = {};
      if (apiResponse.extracted_data_per_page && Array.isArray(apiResponse.extracted_data_per_page)) {
          apiResponse.extracted_data_per_page.forEach(pageData => {
              if (typeof pageData === 'object' && pageData !== null) {
                  Object.assign(combinedData, pageData);
              }
          });
      } else if (typeof apiResponse.extracted_data_per_page === 'object' && apiResponse.extracted_data_per_page !== null){
          combinedData = apiResponse.extracted_data_per_page;
      }


      if (Object.keys(combinedData).length === 0) {
        statusElement.textContent = 'API returned no data for filling.';
        statusElement.style.color = 'orange';
        return;
      }

      statusElement.textContent = 'Data received! Attempting to fill form...';
      statusElement.style.color = 'green';

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: fillPageForm,
        args: [combinedData]
      }, (injectionResults) => {
        if (chrome.runtime.lastError) {
          console.error('Script injection for filling failed:', chrome.runtime.lastError.message);
          statusElement.textContent = `Error injecting script: ${chrome.runtime.lastError.message}`;
          statusElement.style.color = 'red';
        } else if (injectionResults && injectionResults.length > 0 && injectionResults[0].result !== undefined) {
          const result = injectionResults[0].result;
          console.log("Form filling result from content script:", result);

          statusElement.textContent = result.message;
          if (result.success) {
            statusElement.style.color = 'green';
             if (result.fieldsNotFound && result.fieldsNotFound.length > 0) {
                statusElement.style.color = 'orange';
            }
            if (result.fieldsFilled > 0 || (result.success && result.fieldsFilled === 0 && result.fieldsNotFound.length === 0 && result.errorsEncountered.length === 0) ) {
              setTimeout(() => window.close(), 3000);
            }
          } else {
            statusElement.style.color = 'red';
            if (result.fieldsNotFound && result.fieldsNotFound.length > 0 && (!result.errorsEncountered || result.errorsEncountered.length === 0)) {
                statusElement.style.color = 'orange';
            }
          }
        } else {
          console.error('Script injection for filling succeeded but returned no result.');
          statusElement.textContent = 'Form filling script ran, but returned no status.';
          statusElement.style.color = 'orange';
        }
      });

    } catch (error) {
      console.error('Error during API call or processing:', error);
      statusElement.textContent = `Error: ${error.message}`;
      statusElement.style.color = 'red';
    }
  });
});