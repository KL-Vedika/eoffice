console.log('PDF Form Filler extension loaded');

let pdfDetected = false;
let processedIframes = new Set(); // Track all processed iframe sources
let cachedUploadedFile = null; // Cache the uploaded file when detected

// Extract actual PDF URL from PDF.js viewer URLs
function extractActualPdfUrl(viewerUrl) {
  // Basic validation first
  if (!viewerUrl || typeof viewerUrl !== 'string') {
    console.warn('Invalid URL provided to extractActualPdfUrl:', viewerUrl);
    return viewerUrl || '';
  }

  try {
    const url = new URL(viewerUrl);
    
    // Handle PDF.js viewer URLs
    if (url.pathname.includes('viewer.html') || url.pathname.includes('pdf.js')) {
      const fileParam = url.searchParams.get('file');
      if (fileParam) {
        // If it's a relative path, resolve it against the viewer's base
        if (fileParam.startsWith('./') || fileParam.startsWith('../')) {
          const baseUrl = new URL(url.origin + url.pathname.substring(0, url.pathname.lastIndexOf('/')));
          return new URL(fileParam, baseUrl).href;
        } else if (fileParam.startsWith('/')) {
          return url.origin + fileParam;
        } else if (fileParam.startsWith('http')) {
          return fileParam;
        }
      }
    }
    
    return viewerUrl; // Return original if not a viewer URL
  } catch (error) {
    console.warn('Failed to parse PDF viewer URL:', error, 'URL was:', viewerUrl);
    // Return original URL even if parsing fails - it might still be valid
    return viewerUrl;
  }
}

// Validate that URL points to actual PDF content
async function validatePdfUrl(url) {
  if (!url || typeof url !== 'string') {
    console.warn('Invalid URL provided for validation:', url);
    return false;
  }

  try {
    // Try HEAD first (faster)
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors'
    });
    
    // If HEAD succeeds, check content-type
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const isValidContentType = contentType.toLowerCase().includes('application/pdf');
      
      if (!isValidContentType) {
        console.warn('PDF validation failed: Expected application/pdf, got', contentType);
      }
      
      return isValidContentType;
    }
    
    // If HEAD fails with 405 Method Not Allowed, try GET instead
    if (response.status === 405) {
      console.log('HEAD not supported (405), trying GET request for PDF validation');
      
      const getResponse = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Range': 'bytes=0-1023' // Only first 1KB
        }
      });
      
      if (getResponse.ok) {
        const contentType = getResponse.headers.get('content-type') || '';
        const isValidContentType = contentType.toLowerCase().includes('application/pdf');
        
        if (isValidContentType) {
          console.log('✅ PDF validation successful with GET request');
        } else {
          console.warn('PDF validation failed: Expected application/pdf, got', contentType);
        }
        
        return isValidContentType;
              } else {
          console.warn('PDF validation failed: HTTP', getResponse.status, getResponse.statusText);
          return false;
        }
    }
    
    // Other HTTP errors
    console.warn('PDF validation failed: HTTP', response.status, response.statusText);
    return false;
    
  } catch (error) {
    console.warn('PDF validation failed:', error.message);
    
    // Fallback: try a small GET request
    try {
      console.log('Trying fallback GET request for PDF validation');
      
      const fallbackResponse = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Range': 'bytes=0-1023'
        }
      });
      
      if (fallbackResponse.ok) {
        const contentType = fallbackResponse.headers.get('content-type') || '';
        const isValidContentType = contentType.toLowerCase().includes('application/pdf');
        
        if (isValidContentType) {
          console.log('✅ PDF validation successful with fallback GET request');
        }
        
        return isValidContentType;
      }
    } catch (fallbackError) {
      console.warn('PDF validation fallback also failed:', fallbackError.message);
    }
    
    return false;
  }
}

// Monitor for PDF uploads and iframe changes
async function monitorPdfChanges() {
  // 1. PRIORITIZE: Check file inputs first (most reliable)
  const uploadedFile = getPdfFromFileInputs();
  
  if (uploadedFile) {
    if (!pdfDetected) {
      cachedUploadedFile = uploadedFile; // ✅ Cache the file for later use
      pdfDetected = true;
      console.log('✅ PDF detected and cached from file input:', uploadedFile.name);
      
      chrome.runtime.sendMessage({
        type: 'PDF_DETECTED',
        src: `File: ${uploadedFile.name}`,
        actualPdfUrl: null, // File object, not URL
        timestamp: Date.now()
      }).catch(() => {});
    }
    return; // File input found, no need to check iframes
  }

  // 2. FALLBACK: Check iframes only if no file input found
  const iframes = document.querySelectorAll('iframe[data-id-attr="iFrame-id"], iframe[src*=".pdf"], iframe[src*="storage/view"]');
  
  for (const iframe of iframes) {
    if (iframe && iframe.src && !processedIframes.has(iframe.src)) {
      try {
        console.log('🔍 Checking new iframe:', iframe.src);
        
        const actualPdfUrl = extractActualPdfUrl(iframe.src);
        const isValidPdf = await validatePdfUrl(actualPdfUrl);
        
        if (isValidPdf) {
          pdfDetected = true;
          console.log('✅ Valid PDF detected in iframe:', iframe.src);
          console.log('📄 Actual PDF URL:', actualPdfUrl);
          
          chrome.runtime.sendMessage({
            type: 'PDF_DETECTED',
            src: iframe.src,
            actualPdfUrl: actualPdfUrl,
            timestamp: Date.now()
          }).catch(() => {});
          
          break;
        } else {
          console.log('⏭️ Skipping non-PDF content:', iframe.src);
        }
      } catch (error) {
        console.log('⚠️ Error checking iframe:', iframe.src, error.message);
      } finally {
        // ✅ Add to processed and trim memory in one place
        processedIframes.add(iframe.src);
        if (processedIframes.size > 50) {
          const oldestIframe = processedIframes.values().next().value;
          processedIframes.delete(oldestIframe);
          console.log('🧹 Cleaned up old iframe tracking to prevent memory buildup');
        }
      }
    }
  }
}


// Run monitoring every 2 seconds
setInterval(monitorPdfChanges, 2000);

// Initial check
setTimeout(monitorPdfChanges, 1000);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // if (request.type === 'GET_PDF_STATUS') {
  //   sendResponse({
  //     pdfDetected: pdfDetected,
  //     lastIframeSrc: lastIframeSrc
  //   });
  // } 
   if (request.action === 'downloadAndProcess') {
    handleDownloadAndProcess().then(response => {
      sendResponse(response);
    }).catch(error => {
      sendResponse({success: false, message: error.message});
    });
    return true; // Keep message channel open for async response
  } else if (request.action === 'summarizePdf') {
    handleSummarizePdf().then(response => {
      sendResponse(response);
    }).catch(error => {
      sendResponse({success: false, message: error.message});
    });
    return true; // Keep message channel open for async response
  }
});

// Get PDF from file inputs (most reliable method)
function getPdfFromFileInputs() {
  console.log('🔍 Checking file inputs for uploaded PDFs...');
  
  const fileInputs = document.querySelectorAll('input[type="file"]');
  
  for (const input of fileInputs) {
    if (input.files && input.files.length > 0) {
      for (const file of input.files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          console.log('✅ Found PDF in file input:', file.name, `(${(file.size / 1024).toFixed(1)} KB)`);
          return file;
        }
      }
    }
  }
  
  console.log('⏭️ No PDF files found in file inputs');
  return null;
}

// Get PDF from iframes (fallback method)
async function getPdfFromIframes() {
  console.log('🔍 Falling back to iframe detection...');
  
  const iframes = document.querySelectorAll('iframe[data-id-attr="iFrame-id"], iframe[src*=".pdf"], iframe[src*="storage/view"]');
  
  if (!iframes || iframes.length === 0) {
    throw new Error('No PDF iframe found on page');
  }

  console.log(`Found ${iframes.length} potential iframe(s)`);

  for (const iframe of iframes) {
    if (!iframe.src) continue;
    
    try {
      console.log('Checking iframe:', iframe.src);
      
      const actualPdfUrl = extractActualPdfUrl(iframe.src);
      console.log('Extracted PDF URL:', actualPdfUrl);
      
      const isValidPdf = await validatePdfUrl(actualPdfUrl);
      if (isValidPdf) {
        console.log('✅ Found valid PDF in iframe:', actualPdfUrl);
        return actualPdfUrl;
      } else {
        console.log('⏭️ Skipping non-PDF iframe:', iframe.src);
      }
    } catch (error) {
      console.log('⚠️ Error validating iframe:', iframe.src, error.message);
      // Continue to next iframe
    }
  }

  throw new Error('No valid PDF content found in any iframe');
}

// Main function to download PDF and process form
async function handleDownloadAndProcess() {
  try {
    let pdfBlob = null;
    let pdfBase64 = null;

    // 1. PRIORITIZE: Use cached file or check file inputs
    const uploadedFile = getPdfFromFileInputs() || cachedUploadedFile;

    
    if (uploadedFile) {
      console.log('📄 Using uploaded file from', cachedUploadedFile ? 'cache' : 'file input');
      pdfBlob = uploadedFile;
      pdfBase64 = await blobToBase64(pdfBlob);
    } else {
      // 2. FALLBACK: Try iframe detection
      console.log('⚠️ No file input found, trying iframe method...');
      
      const validPdfUrl = await getPdfFromIframes();
      
      // 3. Download actual PDF content from iframe URL
      const pdfResponse = await fetch(validPdfUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
      }

      // Verify content type(Second check- safety purpose)
      const contentType = pdfResponse.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/pdf')) {
        throw new Error(`Expected PDF but got ${contentType}`);
      }

      pdfBlob = await pdfResponse.blob();
      pdfBase64 = await blobToBase64(pdfBlob);
    }

    console.log('📄 PDF ready for processing, size:', pdfBlob.size, 'bytes');

    // 4. Scan form schema
    const formSchema = scanFormFields();
    console.log('Form schema:', formSchema);

    if (Object.keys(formSchema).length === 0) {
      throw new Error('No form fields found on page');
    }

    // 5. Get API endpoint
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['apiEndpoint'], resolve);
    });

    if (!result.apiEndpoint) {
      throw new Error('API Endpoint not configured. Please enter and save it in the extension popup first.');
    }

    const apiEndpoint = result.apiEndpoint;

    // 6. Send to backend for processing
    const processingResponse = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdfData: pdfBase64.split(',')[1], // Remove data:application/pdf;base64, prefix
        formSchema: formSchema
      })
    });

    if (!processingResponse.ok) {
      throw new Error(`Backend error: ${processingResponse.status}`);
    }

    const extractedData = await processingResponse.json();
    console.log('Extracted data:', extractedData);

    // 7. Fill form with extracted data
    const fillResult = fillFormFields(extractedData);

    // 🔐 Clear cache after successful processing
    cachedUploadedFile = null;
    console.log('🧹 Cleared cached file after successful processing');

    return {
      success: true,
      message: `Successfully filled ${fillResult.filled} fields out of ${fillResult.total}`,
      fieldsProcessed: fillResult.filled
    };

  } catch (error) {
    console.error('Error in downloadAndProcess:', error);
    
    // 🔐 Clear cache on error to prevent memory leaks
    cachedUploadedFile = null;
    
    return {
      success: false,
      message: error.message
    };
  }
}

// Main function to download PDF and summarize it (standalone process)
async function handleSummarizePdf() {
  try {
    let pdfBlob = null;
    let pdfBase64 = null;

    // 1. PRIORITIZE: Use cached file or check file inputs
    const uploadedFile = getPdfFromFileInputs() || cachedUploadedFile;

    
    if (uploadedFile) {
      console.log('📄 Using uploaded file from', cachedUploadedFile ? 'cache' : 'file input', 'for summarization');
      pdfBlob = uploadedFile;
      pdfBase64 = await blobToBase64(pdfBlob);
    } else {
      // 2. FALLBACK: Try iframe detection
      console.log('⚠️ No file input found for summarization, trying iframe method...');
      
      const validPdfUrl = await getPdfFromIframes();
      
      // 3. Download actual PDF content from iframe URL
      const pdfResponse = await fetch(validPdfUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF for summarization: ${pdfResponse.status} ${pdfResponse.statusText}`);
      }

      // Verify content type
      const contentType = pdfResponse.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/pdf')) {
        throw new Error(`Expected PDF but got ${contentType} for summarization`);
      }

      pdfBlob = await pdfResponse.blob();
      pdfBase64 = await blobToBase64(pdfBlob);
    }

    console.log('📄 PDF ready for summarization, size:', pdfBlob.size, 'bytes');

    // 4. Get API endpoint for summarization
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['apiEndpoint'], resolve);
    });

    if (!result.apiEndpoint) {
      throw new Error('API Endpoint not configured. Please enter and save it in the extension popup first.');
    }

    // Use the summarize-direct endpoint (independent of process-pdf)
    const baseEndpoint = result.apiEndpoint;
    const summarizeEndpoint = baseEndpoint.replace('/process-pdf', '') + '/summarize-direct';

    console.log('Using summarize-direct endpoint:', summarizeEndpoint);

    // 4. Send to backend for direct summarization
    const summarizeResponse = await fetch(summarizeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdfData: pdfBase64.split(',')[1], // Remove data:application/pdf;base64, prefix
        formSchema: {} // Not needed for summarization
      })
    });

    if (!summarizeResponse.ok) {
      throw new Error(`Summarization backend error: ${summarizeResponse.status}`);
    }

    const summaryData = await summarizeResponse.json();
    console.log('Summary data:', summaryData);

    if (!summaryData.success) {
      throw new Error(summaryData.message || 'Summarization failed');
    }

    // 🔐 Clear cache after successful summarization
    cachedUploadedFile = null;
    console.log('🧹 Cleared cached file after successful summarization');

    return {
      success: true,
      message: 'PDF summarized successfully',
      summary: summaryData.summary,
      pagesProcessed: summaryData.pages_processed || 0
    };

  } catch (error) {
    console.error('Error in handleSummarizePdf:', error);
    
    // 🔐 Clear cache on error to prevent memory leaks
    cachedUploadedFile = null;
    
    return {
      success: false,
      message: error.message
    };
  }
}

// Helper function to convert blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function scanFormFields() {
  const formSchema = {};
  const targetForm = document.getElementById('eofficeForm');
  const searchContext = targetForm || document;

  if (targetForm) {
    console.log('Found eofficeForm, scanning fields within it');
  } else {
    console.log('eofficeForm not found, scanning entire document');
  }

  const fields = searchContext.querySelectorAll('input, select, textarea');
  const radioGroups = {};

  fields.forEach(field => {
    if (!field.id && !field.name) return;

    const fieldId = field.id || field.name;
    const fieldType = field.type || field.tagName.toLowerCase();

    const fieldInfo = {
      type: fieldType,
      name: field.name || field.id,
      id: field.id || '',
      required: getFieldRequired(field),
      label: getFieldLabel(field)
    };

    // Extract options for SELECT
    if (fieldType === 'select') {
      fieldInfo.options = Array.from(field.options).map(opt => ({
        value: opt.value,
        text: opt.text,
        selected: opt.selected
      }));
    }

    // Group RADIO buttons by name
    else if (fieldType === 'radio') {
      const groupName = field.name || fieldId;
      if (!radioGroups[groupName]) {
        radioGroups[groupName] = {
          type: 'radio',
          name: groupName,
          id: field.id || '',
          required: getFieldRequired(field),
          label: getFieldLabel(field),
          options: []
        };
      }

      radioGroups[groupName].options.push({
        value: field.value,
        text: getFieldLabel(field) || field.value,
        checked: field.checked,
        id: field.id
      });

      return; // Skip individual radio field entry
    }

    // Checkbox group detection
    else if (fieldType === 'checkbox') {
      const checkboxGroup = searchContext.querySelectorAll(`input[type="checkbox"][name="${field.name}"]`);
      if (checkboxGroup.length > 1) {
        fieldInfo.options = Array.from(checkboxGroup).map(cb => ({
          value: cb.value,
          text: getFieldLabel(cb) || cb.value,
          checked: cb.checked,
          id: cb.id
        }));
      } else {
        fieldInfo.checked = field.checked;
        fieldInfo.value = field.value;
      }
    }

    // Custom dropdown handling for text inputs
    else if (fieldType === 'text') {
      const customOptions = detectCustomDropdownOptions(field);
      console.log('Custom options:', customOptions);
      if (customOptions.length > 0) {
        fieldInfo.options = customOptions;
      }
    }

    // Include min/max for date/number/range
    if (['date', 'datetime-local', 'time', 'number', 'range'].includes(fieldType)) {
      if (field.min) fieldInfo.min = field.min;
      if (field.max) fieldInfo.max = field.max;
    }

    formSchema[fieldId] = fieldInfo;
  });

  // Add radio groups to the schema
  Object.entries(radioGroups).forEach(([groupName, groupData]) => {
    formSchema[groupName] = groupData;
  });

  console.log('📋 FINAL FORM SCHEMA:', formSchema);
  return formSchema;
}

function getFieldRequired(field) {
  if (!field.id) return false;

  // Get the associated label using the `for` attribute
  const label = document.querySelector(`label[for="${field.id}"]`);
  
  if (label && label.classList.contains('asterisk')) {
    return true;
  }

  return false;
}

function detectCustomDropdownOptions(field) {
  const options = [];

  // 1. Find the dropdown container (from your JS setup)
  const container = field.closest('.custom-dropdown-container');
  if (!container) return options;

  // 2. Find the dropdown panel and list
  const panel = container.querySelector('.dropdown-panel, .autocomplete-panel');
  const list = panel ? panel.querySelector('.dropdown-list') : null;
  if (!list) return options;

  // 3. Get the options from <li> elements inside the list
  const items = list.querySelectorAll('li');

  items.forEach((li) => {
    // Ignore the search input row if present
    if (li.querySelector('.dropdown-search')) return;

    const text = li.textContent.trim();
    const value = li.getAttribute('data-value') || text;

    if (text && !text.toLowerCase().includes('no options')) {
      options.push(value);
    }
  });

  return options;
}

// Helper function to get label text for a field
function getFieldLabel(field) {
  // Try to find label by 'for' attribute
  if (field.id) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) return label.textContent.trim();
  }
  
  // Try to find parent label
  const parentLabel = field.closest('label');
  if (parentLabel) return parentLabel.textContent.replace(field.value || '', '').trim();
  
  // Try to find nearby text (previous sibling, etc.)
  const prevSibling = field.previousElementSibling;
  if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.textContent.trim())) {
    return prevSibling.textContent.trim();
  }
  
  // Check for aria-label
  if (field.getAttribute('aria-label')) {
    return field.getAttribute('aria-label');
  }
  
  // Check for title attribute
  if (field.title) {
    return field.title;
  }
  
  return '';
}

// Fill form fields with extracted data (enhanced version)
function fillFormFields(data) {
  let filled = 0;
  let total = 0;

  // Backend already merges all data, so use it directly
  console.log('🎯 Extracted data to fill:', data);

  // Use same targeting logic as scanFormFields
  const targetForm = document.getElementById('eofficeForm');
  const searchContext = targetForm || document;

  if (targetForm) {
    console.log('Filling fields within eofficeForm');
  } else {
    console.log('eofficeForm not found, filling fields in entire document');
  }

  Object.keys(data).forEach(fieldId => {
    // Skip metadata fields
    if (['success', 'message', 'pages_processed', 'successful_pages', 'fields_extracted', 'temp_id'].includes(fieldId)) {
      return;
    }

    const value = data[fieldId];
    if (value === null || value === undefined || value === '') {
      console.log(`⏭️ Skipping empty value for field: ${fieldId}`);
      return;
    }

    // Try multiple ways to find the field within the target context
    let field = searchContext.querySelector(`#${fieldId}`) || 
                searchContext.querySelector(`[name="${fieldId}"]`) ||
                document.getElementById(fieldId) || 
                document.querySelector(`[name="${fieldId}"]`);

    if (field) {
      total++;
      
      try {
        const fieldType = field.type || field.tagName.toLowerCase();
        let success = false;

        if (fieldType === 'radio') {
          // Handle radio buttons - find all radios with same name and select the matching one
          const radioGroup = searchContext.querySelectorAll(`input[type="radio"][name="${field.name}"]`);
          radioGroup.forEach(radio => {
            if (radio.value === String(value) || 
                radio.value.toLowerCase() === String(value).toLowerCase()) {
              radio.checked = true;
              success = true;
              console.log(`🔘 Selected radio ${fieldId} with value:`, value);
            } else {
              radio.checked = false; // Uncheck others in the group
            }
          });
        }
        else if (fieldType === 'checkbox') {
          // Handle checkboxes - could be single or group
          const checkboxGroup = searchContext.querySelectorAll(`input[type="checkbox"][name="${field.name}"]`);
          
          if (checkboxGroup.length === 1) {
            // Single checkbox
            field.checked = Boolean(value) || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes';
            success = true;
          } else {
            // Checkbox group - value might be array or comma-separated string
            let valuesToCheck = [];
            if (Array.isArray(value)) {
              valuesToCheck = value.map(v => String(v));
            } else {
              valuesToCheck = String(value).split(',').map(v => v.trim());
            }
            
            checkboxGroup.forEach(cb => {
              cb.checked = valuesToCheck.some(val => 
                cb.value === val || cb.value.toLowerCase() === val.toLowerCase()
              );
            });
            success = true;
          }
        }
        else if (fieldType === 'select') {
          // Enhanced select option matching
          const option = Array.from(field.options).find(opt => {
            const optValue = opt.value.toLowerCase();
            const optText = opt.text.toLowerCase();
            const searchValue = String(value).toLowerCase();
            
            return optValue === searchValue || 
                   optText === searchValue ||
                   optText.includes(searchValue) ||
                   searchValue.includes(optText);
          });
          
          if (option) {
            field.value = option.value;
            success = true;
          } else {
            console.warn(`⚠️ No matching option found for ${fieldId}, available options:`, 
              Array.from(field.options).map(opt => `${opt.value}:"${opt.text}"`));
          }
        }
        else if (fieldType === 'date') {
          // Handle date formatting
          const dateValue = formatDateForInput(value);
          if (dateValue) {
            field.value = dateValue;
            success = true;
          }
        }
        else if (fieldType === 'number') {
          // Handle number fields
          const numValue = parseFloat(String(value).replace(/[^\d.-]/g, ''));
          if (!isNaN(numValue)) {
            field.value = numValue;
            success = true;
          }
        }
        else {
          // Text fields and others
          field.value = String(value);
          success = true;
        }
        
        if (success) {
          // Trigger multiple events to ensure compatibility
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          field.dispatchEvent(new Event('blur', { bubbles: true }));
          
          filled++;
          console.log(`✅ Filled field ${fieldId} (${fieldType}):`, value);
        } else {
          console.warn(`⚠️ Failed to fill field ${fieldId} with value:`, value);
        }
        
      } catch (error) {
        console.error(`❌ Error filling field ${fieldId}:`, error);
      }
    } else {
      console.warn(`⚠️ Field not found: ${fieldId}`);
      
      // Try to find similar field names (helpful for debugging)
      const allFields = searchContext.querySelectorAll('input, select, textarea');
      const similarFields = Array.from(allFields)
        .filter(f => (f.id || f.name) && (f.id || f.name).toLowerCase().includes(fieldId.toLowerCase()))
        .map(f => f.id || f.name);
      
      if (similarFields.length > 0) {
        console.log(`💡 Similar field names found: ${similarFields.join(', ')}`);
      }
    }
  });

  console.log(`📊 Form filling completed: ${filled}/${total} fields filled successfully`);
  return { filled, total };
}

// Helper function to format date values for date inputs
function formatDateForInput(dateValue) {
  try {
    // Try to parse various date formats
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      // Try common formats manually
      const dateStr = String(dateValue);
      const patterns = [
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY or DD/MM/YYYY
        /(\d{1,2})-(\d{1,2})-(\d{4})/,   // MM-DD-YYYY or DD-MM-YYYY
        /(\d{4})-(\d{1,2})-(\d{1,2})/,   // YYYY-MM-DD
      ];
      
      for (const pattern of patterns) {
        const match = dateStr.match(pattern);
        if (match) {
          // Assume YYYY-MM-DD format for HTML date input
          if (pattern === patterns[2]) {
            return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else {
            // For other patterns, assume MM/DD/YYYY and convert
            return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
          }
        }
      }
      return null;
    }
    
    // Return in YYYY-MM-DD format for HTML date input
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.warn('Date formatting error:', error);
    return null;
  }
}

// Helper function to clear/reset the form
function clearFormFields() {
  console.log('🧹 Clearing form fields for new document...');
  
  const targetForm = document.getElementById('eofficeForm');
  if (!targetForm) {
    console.warn('eofficeForm not found for clearing');
    return;
  }

  // Clear all text inputs
  const textInputs = targetForm.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], textarea');
  textInputs.forEach(input => {
    // Keep certain default values like language
    if (input.id === 'language-input' || input.name === 'language') {
      input.value = 'English'; // Keep default language
    } else {
      input.value = '';
    }
    // Trigger change event to update any dependent logic
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Clear date inputs
  const dateInputs = targetForm.querySelectorAll('input[type="date"]');
  dateInputs.forEach(input => {
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Reset radio buttons to default (Electronic for receiptNature)
  const radioInputs = targetForm.querySelectorAll('input[type="radio"]');
  radioInputs.forEach(radio => {
    if (radio.name === 'receiptNature' && radio.value === 'E') {
      radio.checked = true; // Keep Electronic as default
    } else {
      radio.checked = false;
    }
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Clear checkboxes
  const checkboxInputs = targetForm.querySelectorAll('input[type="checkbox"]');
  checkboxInputs.forEach(checkbox => {
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Clear select dropdowns
  const selectInputs = targetForm.querySelectorAll('select');
  selectInputs.forEach(select => {
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Clear custom dropdown displays
  const customDropdowns = targetForm.querySelectorAll('.custom-dropdown-container input[type="text"]');
  customDropdowns.forEach(dropdown => {
    // Keep language dropdown with default value
    if (dropdown.id === 'language-input' || dropdown.name === 'language') {
      dropdown.value = 'English';
    } else {
      dropdown.value = '';
    }
    
    // Hide any clear buttons
    const clearBtn = dropdown.parentElement.querySelector('.dropdown-clear');
    if (clearBtn) {
      clearBtn.classList.add('hidden');
    }
  });

  // Reset any visual states
  const selectedItems = targetForm.querySelectorAll('.dropdown-item-selected');
  selectedItems.forEach(item => {
    item.classList.remove('dropdown-item-selected');
  });

  console.log('✅ Form cleared successfully');
}

// Helper function to detect when upload is complete
function detectUploadCompletion() {
  // Watch for changes in file input
  const fileInput = document.getElementById('fileUpload');
  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      if (event.target.files.length > 0) {
        console.log('📄 New file selected for upload:', event.target.files[0].name);
        
        // Reset PDF detection state for new upload
        pdfDetected = false;
        cachedUploadedFile = null; // Clear cached file for new upload
        processedIframes.clear();
        console.log('🧹 Reset PDF detection state and cleared cache for new upload');
        
        // Clear the form immediately when new file is selected
        clearFormFields();
        
        // Monitor for iframe update (indicating upload success)
        let checkCount = 0;
        const uploadMonitor = setInterval(() => {
          checkCount++;
          const iframe = document.querySelector('iframe[data-id-attr="iFrame-id"]');
          
          if (iframe && iframe.src && iframe.src.includes('storage/view')) {
            clearInterval(uploadMonitor);
            console.log('✅ Upload completed, PDF available in iframe');
            
            // Reset state for newly uploaded PDF
            cachedUploadedFile = null; // Clear any previous cached file
            processedIframes.clear();
            console.log('🧹 Cleared cache and processed iframes for new upload detection');
            
            // Send message about upload completion
            chrome.runtime.sendMessage({
              type: 'UPLOAD_COMPLETED',
              filename: event.target.files[0].name,
              iframeSrc: iframe.src
            }).catch(() => {});
          }
          
          // Stop monitoring after 30 seconds
          if (checkCount > 30) {
            clearInterval(uploadMonitor);
            console.log('⏰ Upload monitoring timed out');
          }
        }, 1000);
      }
    });
  }

  // Also watch for iframe src changes (in case PDF is changed via other means)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        const iframe = mutation.target;
        if (iframe.tagName === 'IFRAME' && iframe.src && iframe.src.includes('storage/view')) {
          console.log('🔄 PDF iframe src changed, clearing form...');
          clearFormFields();
        }
      }
    });
  });

  // Start observing iframe changes
  const iframe = document.querySelector('iframe[data-id-attr="iFrame-id"]');
  if (iframe) {
    observer.observe(iframe, { attributes: true, attributeFilter: ['src'] });
  }
}

// Initialize upload monitoring
document.addEventListener('DOMContentLoaded', detectUploadCompletion);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectUploadCompletion);
} else {
  detectUploadCompletion();
} 