"""
Custom exception handler — returns structured FraudShield error responses.

Every API error returns:
{
    "error": {
        "code": "ERROR_CODE",
        "message": "Human-readable description."
    }
}

Never exposes stack traces or API keys in API responses.
"""
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.core.exceptions import ObjectDoesNotExist, ValidationError
import logging

log = logging.getLogger(__name__)

# Map Django/DRF exception types to structured error codes
_CODE_MAP = {
    'NotFound':           'NOT_FOUND',
    'PermissionDenied':   'PERMISSION_DENIED',
    'AuthenticationFailed': 'AUTHENTICATION_FAILED',
    'NotAuthenticated':   'UNAUTHENTICATED',
    'MethodNotAllowed':   'METHOD_NOT_ALLOWED',
    'ParseError':         'INVALID_REQUEST',
    'ValidationError':    'VALIDATION_ERROR',
    'Throttled':          'RATE_LIMITED',
}


def fraudshield_exception_handler(exc, context):
    # Call DRF's default handler first
    response = exception_handler(exc, context)

    if response is None:
        # Handle Django-native exceptions not caught by DRF
        if isinstance(exc, ObjectDoesNotExist):
            response = Response(status=status.HTTP_404_NOT_FOUND)
            exc_code = 'NOT_FOUND'
        elif isinstance(exc, ValidationError):
            response = Response(status=status.HTTP_400_BAD_REQUEST)
            exc_code = 'VALIDATION_ERROR'
        elif isinstance(exc, ValueError):
            response = Response(status=status.HTTP_400_BAD_REQUEST)
            exc_code = 'INVALID_REQUEST'
        else:
            log.exception("Unhandled exception in API view: %s", exc)
            return None

        response.data = {'error': {'code': exc_code, 'message': str(exc)}}
        return response

    exc_code = _CODE_MAP.get(type(exc).__name__, 'ERROR')

    # Reformat the response data
    original_detail = response.data
    if isinstance(original_detail, dict) and 'detail' in original_detail:
        message = str(original_detail['detail'])
    elif isinstance(original_detail, list):
        message = '; '.join(str(e) for e in original_detail)
    else:
        message = str(original_detail)

    response.data = {
        'error': {
            'code': exc_code,
            'message': message,
        }
    }
    return response
