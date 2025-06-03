document.addEventListener('DOMContentLoaded', function () {
    const fileUpload = document.getElementById('fileUpload');
    // const uploadButtonLabel = document.querySelector('.upload-button'); // Not directly used, label for="fileUpload" handles click
    const removeFileButton = document.getElementById('removeFile');
    const previewPlaceholder = document.getElementById('previewPlaceholder');
    const filePreviewArea = document.getElementById('filePreview');
    const documentIdDisplay = document.getElementById('documentIdDisplay');
    const documentIdSpan = documentIdDisplay.querySelector('span');

    const docSearchInput = document.getElementById('docSearchInput');
    const docSearchButton = document.getElementById('docSearchButton');
    const baseUrl = "http://localhost:8000"; // Ensure this matches your FastAPI server

    const eofficeForm = document.getElementById('eofficeForm'); // Get reference to the form
    const processDocumentButton = document.getElementById('processDocumentButton');


    // --- File Upload Logic ---
    fileUpload.addEventListener('change', function (event) {
        const file = event.target.files[0];
        if (file) {
            if (file.type === "application/pdf" && file.size <= 50 * 1024 * 1024) {
                previewPlaceholder.textContent = `Selected: ${file.name}. Uploading...`;
                removeFileButton.style.display = 'inline-block';
                documentIdDisplay.style.display = 'none'; // Hide old ID

                const formData = new FormData();
                formData.append('file', file);

                fetch(`${baseUrl}/upload`, { method: 'POST', body: formData })
                    .then(response => {
                        if (!response.ok) {
                            return response.json().then(err => { throw new Error(err.detail || `Upload failed with status: ${response.status}`) });
                        }
                        return response.json();
                    })
                    .then(data => {
                        console.log('Upload successful:', data);
                        if (data.documentId) {
                            documentIdSpan.textContent = data.documentId;
                            documentIdDisplay.style.display = 'block';
                            previewPlaceholder.textContent = `Uploaded: ${file.name}`;
                            displayPdfPreview(file); // Display local file for preview immediately
                        } else {
                            throw new Error("Document ID not returned from upload.");
                        }
                    })
                    .catch(error => {
                        console.error('Upload error:', error);
                        previewPlaceholder.textContent = `Upload failed: ${error.message}. Please try again.`;
                        removeFile();
                    });
            } else {
                alert('Invalid file. Please upload a PDF smaller than 50MB.');
                removeFile();
            }
        }
    });

    removeFileButton.addEventListener('click', removeFile);

    function removeFile() {
        fileUpload.value = ''; // Clear the file input
        previewPlaceholder.textContent = 'File preview will appear here.';
        previewPlaceholder.style.display = 'block';
        removeFileButton.style.display = 'none';
        documentIdDisplay.style.display = 'none';
        documentIdSpan.textContent = '';
        // Clear the actual preview if an iframe/embed was used
        const existingPreview = filePreviewArea.querySelector('iframe') || filePreviewArea.querySelector('embed');
        if (existingPreview) {
            existingPreview.remove();
        }
        console.log('File removed.');
    }

    function displayPdfPreview(fileOrId) {
        // Clear previous preview
        const existingPreview = filePreviewArea.querySelector('iframe') || filePreviewArea.querySelector('embed');
        if (existingPreview) {
            existingPreview.remove();
        }
        previewPlaceholder.style.display = 'none'; // Hide placeholder text

        const previewElement = document.createElement('iframe');
        previewElement.style.width = '100%';
        previewElement.style.height = '100%';
        previewElement.style.border = 'none';
        previewElement.style.zIndex = '1'; // Ensure it's above watermark

        if (typeof fileOrId === 'string') { // If it's an ID (meaning we fetched it from search)
            fetch(`${baseUrl}/document?id=${encodeURIComponent(fileOrId)}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Could not load document preview: ${response.status}`);
                    }
                    return response.blob();
                })
                .then(blob => {
                    const objectURL = URL.createObjectURL(blob);
                    previewElement.src = objectURL;
                    filePreviewArea.appendChild(previewElement);
                    // Optional: Revoke object URL after iframe has loaded to free memory
                    // previewElement.onload = () => URL.revokeObjectURL(objectURL);
                    console.log(`Previewing document by ID: ${fileOrId}`);
                })
                .catch(error => {
                    console.error('Error fetching document for preview:', error);
                    previewPlaceholder.textContent = `Could not load preview for ID: ${fileOrId}. ${error.message}`;
                    previewPlaceholder.style.display = 'block';
                });
        } else if (fileOrId instanceof File) { // If it's a File object (from upload)
            const objectURL = URL.createObjectURL(fileOrId);
            previewElement.src = objectURL;
            filePreviewArea.appendChild(previewElement);
            // Optional: Revoke object URL after iframe has loaded to free memory
            // previewElement.onload = () => URL.revokeObjectURL(objectURL);
            console.log(`Previewing uploaded file: ${fileOrId.name}`);
        }
    }

    // --- Document Search Logic ---
    docSearchButton.addEventListener('click', function () {
        const query = docSearchInput.value.trim();
        if (query) {
            docSearchButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            docSearchButton.disabled = true;

            fetch(`${baseUrl}/search?query=${encodeURIComponent(query)}`)
                .then(response => {
                     if (!response.ok) {
                        return response.json().then(err => { throw new Error(err.detail || `Search failed with status: ${response.status}`) });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Search results:', data);
                    if (data.results && data.results.length > 0) {
                        const firstResultId = data.results[0].id; // Assuming 'id' is the filename
                        documentIdSpan.textContent = firstResultId;
                        documentIdDisplay.style.display = 'block';
                        displayPdfPreview(firstResultId); // Display by ID
                        previewPlaceholder.textContent = `Displaying search result: ${firstResultId}`; // Keep this minimal
                    } else {
                        previewPlaceholder.textContent = 'No documents found for: ' + query;
                        previewPlaceholder.style.display = 'block';
                        documentIdDisplay.style.display = 'none';
                        documentIdSpan.textContent = '';
                        const existingPreview = filePreviewArea.querySelector('iframe') || filePreviewArea.querySelector('embed');
                        if (existingPreview) existingPreview.remove();
                    }
                })
                .catch(error => {
                    console.error('Search error:', error);
                    previewPlaceholder.textContent = `Search failed: ${error.message}.`;
                    previewPlaceholder.style.display = 'block';
                })
                .finally(() => {
                    docSearchButton.innerHTML = '<i class="fas fa-search"></i>';
                    docSearchButton.disabled = false;
                });
        } else {
            alert('Please enter a search term.');
        }
    });


    // --- Form Submission ---
    eofficeForm.addEventListener('submit', function (event) {
        event.preventDefault(); // Prevent default form submission
        const formData = new FormData(eofficeForm);
        const data = Object.fromEntries(formData.entries());
        data.documentId = documentIdSpan.textContent; // Add the current document ID

        console.log('Form Submitted (Generate & Copy):', data);
        // Here you would typically make an API call with this data
        // e.g., fetch('/api/generateAndCopy', { method: 'POST', body: JSON.stringify(data), headers: {'Content-Type': 'application/json'} })
        alert('Form data logged to console (Simulated Generate & Copy). Document ID: ' + (data.documentId || "N/A"));
    });

    // Add clear functionality to input-with-actions
    document.querySelectorAll('.clear-btn').forEach(button => {
        button.addEventListener('click', function () {
            const inputField = this.closest('.input-with-actions').querySelector('input[type="text"]');
            if (inputField) {
                inputField.value = '';
                inputField.focus();
            }
        });
    });

    // --- Process Document Button Logic ---
    if (processDocumentButton) {
        processDocumentButton.addEventListener('click', async function() {
            const currentDocumentId = documentIdSpan.textContent;
            if (!currentDocumentId) {
                alert('Please upload or search for a document first.');
                return;
            }

            // --- Generate Form Schema ---
            const formSchema = {};
            Array.from(eofficeForm.elements).forEach(element => {
                if (element.id) { // Only include elements with an ID
                    let elementType;
                    const tagName = element.tagName.toLowerCase();
                    if (tagName === 'input') {
                        elementType = element.type.toLowerCase(); // e.g., 'text', 'date', 'radio', 'checkbox', 'email', 'tel'
                    } else if (tagName === 'select') {
                        elementType = 'select';
                    } else if (tagName === 'textarea') {
                        elementType = 'textarea';
                    } else {
                        // Fallback for other potential form-related elements with IDs
                        elementType = tagName;
                    }
                    formSchema[element.id] = elementType;
                }
            });
            // --- End of Schema Generation ---

            const originalButtonText = this.innerHTML;
            this.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            this.disabled = true;

            try {
                const response = await fetch(`${baseUrl}/process`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        documentId: currentDocumentId,
                        form_schema: formSchema // Sending the generated form schema
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ detail: "Unknown error during processing." }));
                    throw new Error(`Processing failed: ${response.status} ${errorData.detail || response.statusText}`);
                }

                const result = await response.json();
                console.log('Processing result:', result);
                console.log('Form schema sent:', formSchema);

                if (result.extracted_data_per_page) {
                    let combinedData = {};
                    if (Array.isArray(result.extracted_data_per_page)) {
                        result.extracted_data_per_page.forEach(pageData => {
                            if (typeof pageData === 'object' && pageData !== null) {
                               Object.assign(combinedData, pageData);
                            }
                        });
                    } else if (typeof result.extracted_data_per_page === 'object' && result.extracted_data_per_page !== null) {
                        // If backend sends a single object instead of array
                        combinedData = result.extracted_data_per_page;
                    }


                    let fieldsFilledCount = 0;
                    for (const idInResponse in combinedData) {
                        if (Object.hasOwnProperty.call(combinedData, idInResponse)) {
                            const element = document.getElementById(idInResponse);
                            const valueToFill = combinedData[idInResponse];

                            if (element) {
                                const elementTypeFromSchema = formSchema[idInResponse]; // Get type from our schema

                                if (elementTypeFromSchema === 'radio') {
                                    // For radio buttons, the model should ideally return the ID of the radio button
                                    // that should be checked, and its value should be true.
                                    // Or, it could return the 'name' of the radio group and the 'value' to select.
                                    // Current logic: if the ID matches and valueToFill is true-ish, check it.
                                    // Or if the valueToFill matches the element's value (for the specific radio button).
                                    if (valueToFill === true || String(valueToFill).toLowerCase() === 'true' || String(valueToFill).toLowerCase() === element.value.toLowerCase()) {
                                        element.checked = true;
                                        fieldsFilledCount++;
                                        console.log(`Populated radio field ID '${idInResponse}' with value: '${valueToFill}' -> CHECKED`);
                                    } else {
                                        // If the model is trying to set a radio group by its name, this won't work directly here.
                                        // This part assumes the model is very specific about which radio ID to check.
                                        // To handle group setting: if model returns {"radioGroupName": "valueToSelect"},
                                        // you'd need to find `document.querySelector('input[name="radioGroupName"][value="valueToSelect"]')`.
                                        console.log(`Skipping radio field ID '${idInResponse}' with value: '${valueToFill}' (not true or matching element value)`);
                                    }
                                } else if (elementTypeFromSchema === 'checkbox') {
                                    element.checked = Boolean(valueToFill);
                                    fieldsFilledCount++;
                                    console.log(`Populated checkbox field ID '${idInResponse}' with value: '${valueToFill}' -> CHECKED: ${element.checked}`);
                                } else if (elementTypeFromSchema === 'select') {
                                    element.value = valueToFill;
                                    // Trigger change event if needed for dependent dropdowns
                                    const event = new Event('change', { bubbles: true });
                                    element.dispatchEvent(event);
                                    fieldsFilledCount++;
                                    console.log(`Populated select field ID '${idInResponse}' with value: '${valueToFill}'`);
                                } else { // Covers 'text', 'date', 'email', 'tel', 'textarea', etc.
                                    element.value = valueToFill;
                                    fieldsFilledCount++;
                                    console.log(`Populated field ID '${idInResponse}' (type: ${elementTypeFromSchema}) with value: '${valueToFill}'`);
                                }
                            } else {
                                console.warn(`Element with ID '${idInResponse}' (value: '${valueToFill}') returned by AI not found in the form schema or DOM.`);
                            }
                        }
                    }
                    if (fieldsFilledCount > 0) {
                        alert(`Document processed. ${fieldsFilledCount} fields were populated based on AI output.`);
                    } else {
                        alert('Document processed, but no matching fields were populated. Check AI output and form field IDs/values.');
                    }
                } else {
                    alert('Processing completed, but no data was extracted or returned in the expected format.');
                }

            } catch (error) {
                console.error('Error processing document:', error);
                alert(`Error: ${error.message}`);
            } finally {
                processDocumentButton.innerHTML = originalButtonText;
                processDocumentButton.disabled = false;
            }
        });
    } else {
        console.warn("Process Document Button not found in the DOM.");
    }

    // Set default dates for date inputs to today
    function setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('diaryDate').value = today;
        document.getElementById('receivedDate').value = today;
        // document.getElementById('letterDate').value = today; // Optional: letterDate might not always be today
    }
    setDefaultDates();

}); // End of DOMContentLoaded