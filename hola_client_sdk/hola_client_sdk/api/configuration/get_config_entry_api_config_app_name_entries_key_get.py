from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_config_entry_response import ApiResponseConfigEntryResponse
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
    key: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/config/{app_name}/entries/{key}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseConfigEntryResponse.from_dict(response.json())

        return response_200
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
    key: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Get Config Entry

     Get a specific configuration entry.

    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        404: Entry not found
        500: Internal server error

    Args:
        app_name (str):
        key (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        key=key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    key: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Get Config Entry

     Get a specific configuration entry.

    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        404: Entry not found
        500: Internal server error

    Args:
        app_name (str):
        key (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigEntryResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        key=key,
        client=client,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    key: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Get Config Entry

     Get a specific configuration entry.

    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        404: Entry not found
        500: Internal server error

    Args:
        app_name (str):
        key (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        key=key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    key: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponseConfigEntryResponse, HTTPValidationError]]:
    """Get Config Entry

     Get a specific configuration entry.

    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration entry response

    Raises:
        400: Validation error - invalid app name or key
        404: Entry not found
        500: Internal server error

    Args:
        app_name (str):
        key (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigEntryResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            key=key,
            client=client,
        )
    ).parsed
