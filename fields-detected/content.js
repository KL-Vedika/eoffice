console.log('Fields Detector extension loaded');

// Test if script is working
if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('Chrome runtime available, extension ready');
} else {
  console.error('Chrome runtime not available');
}

// Utility function to check if an element is visible
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0' &&
         element.offsetParent !== null;
}

// Check if element is part of Angular component
function isAngularElement(element) {
  try {
    return element.hasAttribute('ng-reflect-name') || 
           element.hasAttribute('formcontrolname') ||
           element.hasAttribute('ng-model') ||
           element.hasAttribute('data-ng-model') ||
           element.closest('[ng-reflect-form]') !== null ||
           element.closest('[formgroup]') !== null ||
           element.closest('[ng-version]') !== null ||
           document.querySelector('[ng-version]') !== null;
  } catch (error) {
    console.warn('Error checking Angular element:', error);
    return false;
  }
}

// Get Angular form control name
function getAngularControlName(element) {
  try {
    return element.getAttribute('formcontrolname') || 
           element.getAttribute('ng-reflect-name') ||
           element.getAttribute('ng-model') ||
           element.getAttribute('data-ng-model') ||
           element.getAttribute('name');
  } catch (error) {
    console.warn('Error getting Angular control name:', error);
    return null;
  }
}

// Check if element is dynamically rendered
function isDynamicElement(element) {
  try {
    // Check for common Angular structural directives (use valid CSS selectors)
    return element.hasAttribute('*ngIf') || 
           element.hasAttribute('*ngFor') ||
           element.closest('[ng-reflect-ng-if]') !== null ||
           element.closest('[ng-reflect-ng-for-of]') !== null ||
           element.closest('[data-ng-if]') !== null ||
           element.closest('[data-ng-for]') !== null;
  } catch (error) {
    console.warn('Error checking dynamic element:', error);
    return false;
  }
}

// Check if element is behind a tab/conditional
function isHiddenByCondition(element) {
  try {
    // Check parent visibility
    let parent = element.parentElement;
    while (parent) {
      if (parent.hasAttribute('hidden') || 
          parent.style.display === 'none' ||
          parent.hasAttribute('ng-reflect-ng-if') ||
          parent.hasAttribute('data-ng-if')) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  } catch (error) {
    console.warn('Error checking hidden condition:', error);
    return false;
  }
}

// Analyze a single form field
function analyzeFormField(element) {
  if (!element) {
    throw new Error('Element is null or undefined');
  }
  
  const fieldName = element.name || element.id || getAngularControlName(element);
  const fieldType = element.type || element.tagName?.toLowerCase() || 'unknown';
  
  const analysis = {
    name: fieldName || 'unnamed',
    type: fieldType,
    isAngular: isAngularElement(element),
    issues: 0,
    checks: []
  };

  // Check 1: Selector Usage
  const selectors = {
    formControlName: element.hasAttribute('formcontrolname'),
    name: element.hasAttribute('name'),
    id: element.hasAttribute('id')
  };
  analysis.checks.push({
    title: 'Selector Usage',
    status: Object.values(selectors).some(Boolean) ? 'success' : 'error',
    description: Object.values(selectors).some(Boolean) 
      ? `Using ${Object.entries(selectors).filter(([,v]) => v).map(([k]) => k).join(', ')}`
      : 'No standard selectors found'
  });

  // Check 2: Event Handling
  const hasChangeHandler = element.hasAttribute('(change)') || element.hasAttribute('(input)');
  const hasBlurHandler = element.hasAttribute('(blur)');
  analysis.checks.push({
    title: 'Event Handling',
    status: (hasChangeHandler && hasBlurHandler) ? 'success' : 'warning',
    description: `${hasChangeHandler ? '✓ Change/Input' : '✗ No Change'}, ${hasBlurHandler ? '✓ Blur' : '✗ No Blur'}`
  });

  // Check 3: Change Detection
  const isInAngularZone = element.closest('[ng-version]') !== null;
  analysis.checks.push({
    title: 'Change Detection',
    status: isInAngularZone ? 'success' : 'warning',
    description: isInAngularZone ? 'Inside Angular zone' : 'Outside Angular zone'
  });

  // Check 4: Form Control State
  const hasFormControl = element.closest('form') !== null && analysis.isAngular;
  analysis.checks.push({
    title: 'Form Control State',
    status: hasFormControl ? 'success' : 'warning',
    description: hasFormControl ? 'Part of Angular form' : 'Not in Angular form'
  });

  // Check 5: Event Bubbling
  const hasStopPropagation = element.hasAttribute('(click.stop)') || element.hasAttribute('(input.stop)');
  analysis.checks.push({
    title: 'Event Bubbling',
    status: !hasStopPropagation ? 'success' : 'warning',
    description: hasStopPropagation ? 'Events stopped from bubbling' : 'Events bubble correctly'
  });

  // Check 6: Select Options (if applicable)
  if (element.tagName === 'SELECT') {
    const hasOptions = element.options.length > 0;
    analysis.checks.push({
      title: 'Select Options',
      status: hasOptions ? 'success' : 'error',
      description: hasOptions ? `${element.options.length} options found` : 'No options found'
    });
  }

  // Check 7: Dynamic Rendering
  const isDynamic = isDynamicElement(element);
  analysis.checks.push({
    title: 'Dynamic Rendering',
    status: isDynamic ? 'warning' : 'success',
    description: isDynamic ? 'Dynamically rendered - may need delay' : 'Static element'
  });

  // Check 8: Event Trust
  const hasNgZone = window['NgZone'] !== undefined;
  analysis.checks.push({
    title: 'Event Trust',
    status: hasNgZone ? 'warning' : 'error',
    description: hasNgZone ? 'NgZone available but events not trusted' : 'NgZone not found'
  });

  // Check 8.5: ng.getComponent Access
  const hasGetComponent = typeof window['ng'] !== 'undefined' && typeof window['ng']['getComponent'] === 'function';
  analysis.checks.push({
    title: 'Component Access',
    status: hasGetComponent ? 'success' : 'warning',
    description: hasGetComponent ? 'ng.getComponent available for direct access' : 'ng.getComponent not available (prod mode or not Angular)'
  });

  // Check 9: Value Persistence
  const hasValueBinding = element.hasAttribute('[ngModel]') || element.hasAttribute('[(ngModel)]');
  analysis.checks.push({
    title: 'Value Persistence',
    status: hasValueBinding ? 'success' : 'warning',
    description: hasValueBinding ? 'Two-way binding found' : 'No two-way binding'
  });

  // Check 10: FormControl Integration
  const hasReactiveForm = element.closest('form[formGroup]') !== null;
  analysis.checks.push({
    title: 'FormControl Integration',
    status: hasReactiveForm ? 'success' : 'warning',
    description: hasReactiveForm ? 'Using Reactive Form' : 'Not using Reactive Form'
  });

  // Count critical issues
  analysis.issues = analysis.checks.filter(check => check.status === 'error').length;

  return analysis;
}

// Main function to analyze all form fields
function analyzeFormFields() {
  try {
    const formFields = document.querySelectorAll('input, select, textarea');
    console.log(`Found ${formFields.length} form fields to analyze`);
    
    const results = {
      fields: [],
      summary: {
        totalFields: formFields.length,
        issuesFound: 0,
        angularFields: 0
      }
    };

    formFields.forEach((field, index) => {
      try {
        console.log(`Analyzing field ${index + 1}/${formFields.length}:`, field);
        const analysis = analyzeFormField(field);
        results.fields.push(analysis);
        
        if (analysis.isAngular) results.summary.angularFields++;
        results.summary.issuesFound += analysis.issues;
      } catch (fieldError) {
        console.error(`Error analyzing field ${index + 1}:`, fieldError, field);
        // Add a basic error entry for this field
        results.fields.push({
          name: 'Error analyzing field',
          type: 'unknown',
          isAngular: false,
          issues: 1,
          checks: [{
            title: 'Analysis Error',
            status: 'error',
            description: `Failed to analyze: ${fieldError.message}`
          }]
        });
        results.summary.issuesFound++;
      }
    });

    console.log('Final analysis results:', results);
    return results;
  } catch (error) {
    console.error('Critical error in analyzeFormFields:', error);
    throw new Error(`Field analysis failed: ${error.message}`);
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeFields') {
    try {
      console.log('Starting field analysis...');
      const results = analyzeFormFields();
      console.log('Analysis completed:', results);
      sendResponse({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('Error during field analysis:', error);
      sendResponse({
        success: false,
        error: error.message || 'Failed to analyze fields'
      });
    }
  }
  return true; // Keep message channel open for async response
}); 