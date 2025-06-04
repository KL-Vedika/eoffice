document.addEventListener('DOMContentLoaded', function () {
  const fillFormButton = document.getElementById('fillFormButton');
  const statusElement = document.getElementById('status');
  const apiEndpointInput = document.getElementById('apiEndpointInput');
  const saveEndpointButton = document.getElementById('saveEndpointButton');
  const endpointStatusElement = document.getElementById('endpointStatus');

  const API_ENDPOINT_KEY = 'formFillerApiEndpoint'; // Key for chrome.storage

  // Helper function to promisify chrome.storage.sync.get
  function getStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });
  }

  // Load saved API endpoint on popup open
  getStorageData([API_ENDPOINT_KEY])
    .then(result => {
      if (result[API_ENDPOINT_KEY]) {
        apiEndpointInput.value = result[API_ENDPOINT_KEY];
      } else {
        // Optional: set a default if nothing is stored, or rely on placeholder
        // apiEndpointInput.value = 'http://localhost:8000/default_process';
      }
    })
    .catch(error => {
      console.error("Error loading API endpoint from storage:", error);
      endpointStatusElement.textContent = 'Error loading endpoint.';
      endpointStatusElement.style.color = 'red';
    });

  // Event listener for saving the API endpoint
  saveEndpointButton.addEventListener('click', () => {
    const endpoint = apiEndpointInput.value.trim();
    if (endpoint) {
      try {
        new URL(endpoint); // Basic validation for URL format
        chrome.storage.sync.set({ [API_ENDPOINT_KEY]: endpoint }, () => {
          if (chrome.runtime.lastError) {
            console.error("Error saving endpoint:", chrome.runtime.lastError);
            endpointStatusElement.textContent = `Error: ${chrome.runtime.lastError.message}`;
            endpointStatusElement.style.color = 'red';
          } else {
            endpointStatusElement.textContent = 'Endpoint saved!';
            endpointStatusElement.style.color = 'green';
            setTimeout(() => endpointStatusElement.textContent = '', 3000);
          }
        });
      } catch (e) {
        endpointStatusElement.textContent = 'Invalid URL format.';
        endpointStatusElement.style.color = 'red';
      }
    } else {
      // Optionally, allow clearing the endpoint
      chrome.storage.sync.remove(API_ENDPOINT_KEY, () => {
        endpointStatusElement.textContent = 'Endpoint cleared.';
        endpointStatusElement.style.color = 'orange';
        setTimeout(() => endpointStatusElement.textContent = '', 3000);
      });
      // endpointStatusElement.textContent = 'Endpoint cannot be empty.';
      // endpointStatusElement.style.color = 'red';
    }
  });

  function getDocumentIdFromPdfIframe() {
    // 1. Select the iframe.
    //    The iframe has a data-id-attr="iFrame-id" which is a good selector.
    const iframeElement = document.querySelector('iframe[data-id-attr="iFrame-id"]');

    if (!iframeElement) {
      console.error("PDF iframe not found on the page.");
      return null;
    }

    const iframeSrc = iframeElement.src;

    if (!iframeSrc) {
      console.error("PDF iframe does not have a 'src' attribute or it's empty.");
      return null;
    }

    // 2. Extract the ID using a regular expression.
    //    This regex looks for "/storage/view/" followed by one or more alphanumeric characters (the ID).
    //    The parentheses ( ) create a capturing group for the ID itself.
    const regex = /\/storage\/view\/([a-zA-Z0-9]+)/;
    const match = iframeSrc.match(regex);

    if (match && match[1]) {
      // match[0] is the full matched string (e.g., "/storage/view/683edbb208c12a6a8e4977f3")
      // match[1] is the content of the first capturing group (the ID itself)
      return match[1];
    } else {
      console.error("Could not extract document ID from iframe src:", iframeSrc);
      return null;
    }
  }



// Function to be injected into the page to get its details
function getPageDetailsAndSchema() {
  // Move getDocumentIdFromPdfIframe inside this function
  function getDocumentIdFromPdfIframe() {
    // 1. Select the iframe.
    //    The iframe has a data-id-attr="iFrame-id" which is a good selector.
    const iframeElement = document.querySelector('iframe[data-id-attr="iFrame-id"]');

    if (!iframeElement) {
      console.error("PDF iframe not found on the page.");
      return null;
    }

    const iframeSrc = iframeElement.src;

    if (!iframeSrc) {
      console.error("PDF iframe does not have a 'src' attribute or it's empty.");
      return null;
    }

    // 2. Extract the ID using a regular expression.
    //    This regex looks for "/storage/view/" followed by one or more alphanumeric characters (the ID).
    //    The parentheses ( ) create a capturing group for the ID itself.
    const regex = /\/storage\/view\/([a-zA-Z0-9]+)/;
    const match = iframeSrc.match(regex);

    if (match && match[1]) {
      // match[0] is the full matched string (e.g., "/storage/view/683edbb208c12a6a8e4977f3")
      // match[1] is the content of the first capturing group (the ID itself)
      return match[1];
    } else {
      console.error("Could not extract document ID from iframe src:", iframeSrc);
      return null;
    }
  }

  try {
    // Now call the function that's defined within this scope
    const documentId = getDocumentIdFromPdfIframe();

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

          if (currentValue !== null) {
            if (typeof currentValue === 'string' && currentValue.trim() !== '') {
              schemaEntry.currentValue = currentValue;
            } else if (typeof currentValue === 'boolean') {
              schemaEntry.currentValue = currentValue;
            } else if (typeof currentValue === 'number') {
              schemaEntry.currentValue = currentValue;
            }
          }
          formSchema[element.id] = schemaEntry;
        }
      });
    } else {
      console.warn('Extension: Form with ID "eofficeForm" not found on page.');
    }

    const pageHTML = document.documentElement.outerHTML;

    if (!documentId) {
      console.warn('Extension: Document ID not found on the page.');
    }
    return { success: true, documentId, formSchema, pageHTML, error: null };
  } catch (e) {
    console.error("Extension: Error getting page details in content script:", e);
    return { success: false, documentId: null, formSchema: {}, pageHTML: null, error: e.message };
  }
}

  // Function to be injected to fill the page's form
  function fillPageForm(apiData) {
    // ... (This function remains unchanged from your provided code)
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
                if (element.getAttribute('name') === key && element.value === value) {
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
                continue;
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


  // --- Event Listener for the "Get Details & Fill Form" Button ---
  fillFormButton.addEventListener('click', async () => {
    statusElement.textContent = 'Initializing...';
    statusElement.style.color = 'black';

    // 1. Get API Endpoint from storage
    let currentApiEndpoint;
    try {
      const storedData = await getStorageData([API_ENDPOINT_KEY]);
      if (storedData[API_ENDPOINT_KEY]) {
        currentApiEndpoint = storedData[API_ENDPOINT_KEY];
        // Validate URL format again before use
        try {
          new URL(currentApiEndpoint);
        } catch (e) {
          statusElement.textContent = 'Configured API Endpoint is invalid. Please check and save a valid URL.';
          statusElement.style.color = 'red';
          apiEndpointInput.focus();
          return;
        }
      } else {
        statusElement.textContent = 'API Endpoint not configured. Please enter and save it first.';
        statusElement.style.color = 'red';
        apiEndpointInput.focus();
        return;
      }
    } catch (error) {
      console.error('Error retrieving API endpoint from storage:', error);
      statusElement.textContent = 'Error retrieving API endpoint. Check console.';
      statusElement.style.color = 'red';
      return;
    }

    statusElement.textContent = 'Getting page details...';
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
          throw new Error(`Failed to get page details: ${pageDetails.error || 'Unknown error in content script'}`);
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
          schemaLength: Object.keys(pageDetails.formSchema || {}).length,
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
    const payload = {
      documentId: pageDetails.documentId,
      form_schema: pageDetails.formSchema,
      pageHTML: pageDetails.pageHTML
    };

    try {
      const response = await fetch(currentApiEndpoint, { // Use the retrieved endpoint
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
            const textBody = await response.text(); // Try to get text if JSON fails
            if (textBody) errorDetail += `. Details: ${textBody}`;
          }
        } catch (e) {
          console.warn("Could not read detailed error response body:", e);
          // Attempt to read as text if JSON parsing failed or if it wasn't JSON
          const textBody = await response.text().catch(() => "");
          if (textBody) errorDetail += `. Details: ${textBody}`;
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
      } else if (typeof apiResponse.extracted_data_per_page === 'object' && apiResponse.extracted_data_per_page !== null) {
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
              statusElement.style.color = 'orange'; // Downgrade to warning if some fields not found
            }
            // Close popup on success if fields were filled or if no fields were expected and none were missed
            if (result.fieldsFilled > 0 || (result.fieldsFilled === 0 && (!result.fieldsNotFound || result.fieldsNotFound.length === 0) && (!result.errorsEncountered || result.errorsEncountered.length === 0))) {
              setTimeout(() => window.close(), 3000);
            }
          } else {
            statusElement.style.color = 'red';
            // If only not found errors, could be orange
            if (result.fieldsNotFound && result.fieldsNotFound.length > 0 && (!result.errorsEncountered || result.errorsEncountered.length === 0)) {
              statusElement.style.color = 'orange';
            }
          }
        } else {
          console.error('Script injection for filling succeeded but returned no result or undefined result.');
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