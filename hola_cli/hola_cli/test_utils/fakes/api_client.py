
from typing import Dict, List, Any, Optional

class FakeResponse:
    """A fake HTTP response object."""
    def __init__(self, status_code: int, data: Any = None, text: Optional[str] = None, headers: Optional[Dict[str, str]] = None):
        self.status_code = status_code
        self.data = data
        self._text = text
        self.headers = headers or {"Content-Type": "application/json"}

    def json(self) -> Any:
        """Return JSON decoded data."""
        if self.headers.get("Content-Type") == "application/json":
            return self.data
        raise ValueError("Content-Type is not application/json")

    @property
    def text(self) -> Optional[str]:
        """Return raw text content."""
        if self._text is not None:
            return self._text
        if self.data is not None and isinstance(self.data, (str, bytes)):
             return str(self.data)
        if self.data is not None:
            import json
            try:
                return json.dumps(self.data)
            except TypeError:
                return str(self.data)
        return None

    @property
    def content(self) -> Optional[bytes]:
        """Return raw content as bytes."""
        if self.text:
            return self.text.encode('utf-8')
        return None

    def raise_for_status(self) -> None:
        """Raise an HTTPError if the HTTP request returned an unsuccessful status code."""
        if 400 <= self.status_code < 600:
            # A more sophisticated fake might raise a custom FakeHTTPError here
            raise Exception(f"Fake HTTP Error: {self.status_code}")

    @property
    def parsed(self) -> Any: # To match hola_client_sdk.types.Response
        return self.data

class FakeApiClient:
    """A fake API client that mimics the real API client's interface."""
    def __init__(self):
        self.responses: Dict[str, Dict[str, FakeResponse]] = {}
        self.request_history: List[Dict[str, Any]] = []
        self.default_response: Optional[FakeResponse] = None

    def set_response(
        self, 
        method: str, 
        url: str, 
        response_data: Any, 
        status_code: int = 200,
        response_text: Optional[str] = None,
        response_headers: Optional[Dict[str, str]] = None
    ) -> None:
        """Configure a response for a specific method/URL combination."""
        method_upper = method.upper()
        if method_upper not in self.responses:
            self.responses[method_upper] = {}
        self.responses[method_upper][url] = FakeResponse(
            status_code=status_code, 
            data=response_data, 
            text=response_text,
            headers=response_headers
        )

    def set_default_response(
        self, 
        response_data: Any, 
        status_code: int = 200,
        response_text: Optional[str] = None,
        response_headers: Optional[Dict[str, str]] = None
    ) -> None:
        """Configure a default response if no specific response is found."""
        self.default_response = FakeResponse(
            status_code=status_code, 
            data=response_data, 
            text=response_text,
            headers=response_headers
        )

    def sync_detailed(
        self, 
        method: str, 
        url: str, 
        *, 
        json: Optional[Any] = None, 
        data: Optional[Any] = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        **kwargs: Any
    ) -> FakeResponse: # Changed from hola_client_sdk.types.Response to FakeResponse
        """Simulate the sync_detailed method from the real API client."""
        method_upper = method.upper()
        
        # Record the request
        request_log = {
            "method": method_upper,
            "url": url,
            "json": json,
            "data": data,
            "params": params,
            "headers": headers,
            "kwargs": kwargs
        }
        self.request_history.append(request_log)

        # Find and return the configured response
        if method_upper in self.responses and url in self.responses[method_upper]:
            return self.responses[method_upper][url]
        
        if self.default_response:
            return self.default_response

        # Default fallback if no specific or default response is set
        return FakeResponse(404, {"error": "Not Found"}, text='{"error": "Not Found"}')

    # Add other HTTP methods (get, post, put, delete) for convenience if needed,
    # though sync_detailed is the primary method used by the SDK.

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.sync_detailed(method="GET", url=url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.sync_detailed(method="POST", url=url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.sync_detailed(method="PUT", url=url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.sync_detailed(method="DELETE", url=url, **kwargs)

    def get_request_history(self) -> List[Dict[str, Any]]:
        """Return history of all requests made."""
        return self.request_history

    def clear_request_history(self) -> None:
        """Clear the request history."""
        self.request_history = []

    def reset(self) -> None:
        """Clear all configured responses and request history."""
        self.responses = {}
        self.request_history = []
        self.default_response = None
