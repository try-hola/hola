from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_config_entry_response import ApiResponseConfigEntryResponse
from ...models.config_create_request import ConfigCreateRequest
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
    *,
    body: ConfigCreateRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/config/{app_name}/entries",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    if response.status_code == 201:
        response_201 = ApiResponseConfigEntryResponse.from_dict(response.json())

        return response_201
    if response.status_code == 422:
        response_422 = HTTPValidationError.from_dict(response.json())

        return response_422
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: ConfigCreateRequest,
) -> Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Create Config Entry

     Create a new configuration entry.

    Args:
        app_name: Name of the application
        request: Configuration creation request
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        500: Internal server error

    Args:
        app_name (str):
        body (ConfigCreateRequest): Request to create a new configuration entry.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: ConfigCreateRequest,
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Create Config Entry

     Create a new configuration entry.

    Args:
        app_name: Name of the application
        request: Configuration creation request
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        500: Internal server error

    Args:
        app_name (str):
        body (ConfigCreateRequest): Request to create a new configuration entry.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigEntryResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: ConfigCreateRequest,
) -> Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Create Config Entry

     Create a new configuration entry.

    Args:
        app_name: Name of the application
        request: Configuration creation request
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        500: Internal server error

    Args:
        app_name (str):
        body (ConfigCreateRequest): Request to create a new configuration entry.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: ConfigCreateRequest,
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Create Config Entry

     Create a new configuration entry.

    Args:
        app_name: Name of the application
        request: Configuration creation request
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        500: Internal server error

    Args:
        app_name (str):
        body (ConfigCreateRequest): Request to create a new configuration entry.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigEntryResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            body=body,
        )
    ).parsed
