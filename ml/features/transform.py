# ml/features/transform.py
import numpy as np
from typing import Dict, Any, List
from .schema import FEATURE_SPEC, ORDERED_FEATURE_NAMES

def flatten_features(features_dict: Dict[str, Any]) -> np.ndarray:
    """
    Transforms the nested Node.js features object into a flat numpy array
    suitable for the ML model, filling in missing keys with defaults.
    """
    flat_features = []
    
    for category, expected_features in FEATURE_SPEC.items():
        provided_category = features_dict.get(category, {})
        for feature_name, default_val in expected_features.items():
            if not isinstance(default_val, (int, float, bool)):
                continue # Skip non-scalar features (like arrays/strings)
                
            val = provided_category.get(feature_name, default_val)
            # Ensure proper type conversion
            if isinstance(default_val, bool):
                val = bool(val)
            elif isinstance(default_val, float):
                val = float(val)
            elif isinstance(default_val, int):
                val = int(val)
            
            flat_features.append(val)
            
    return np.array(flat_features, dtype=np.float32)

def to_dict_with_defaults(features_dict: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Returns a nested dictionary matching the FEATURE_SPEC schema exactly,
    filling in defaults where keys are missing.
    """
    result = {}
    for category, expected_features in FEATURE_SPEC.items():
        provided_category = features_dict.get(category, {})
        result[category] = {}
        for feature_name, default_val in expected_features.items():
            result[category][feature_name] = provided_category.get(feature_name, default_val)
    return result
