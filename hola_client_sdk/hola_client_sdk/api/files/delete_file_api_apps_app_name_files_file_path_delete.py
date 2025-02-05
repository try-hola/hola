from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response import ApiResponse
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
    file_path: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": f"/api/apps/{app_name}/files/{file_path}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponse, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    app_name: str,
    file_path: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponse, HTTPValidationError]]:
    """Delete File

     Delete a specific file.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file_path: Path of the file to delete
        service: App service instance
        api_key: API key for authentication

    Returns:
        Success confirmation

    Raises:
        400: Validation error
        404: File not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        file_path (str): Path of the file to delete

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        file_path=file_path,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    file_path: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponse, HTTPValidationError]]:
    """Delete File

     Delete a specific file.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file_path: Path of the file to delete
        service: App service instance
        api_key: API key for authentication

    Returns:
        Success confirmation

    Raises:
        400: Validation error
        404: File not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        file_path (str): Path of the file to delete

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        file_path=file_path,
        client=client,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    file_path: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponse, HTTPValidationError]]:
    """Delete File

     Delete a specific file.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file_path: Path of the file to delete
        service: App service instance
        api_key: API key for authentication

    Returns:
        Success confirmation

    Raises:
        400: Validation error
        404: File not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        file_path (str): Path of the file to delete

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        file_path=file_path,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    file_path: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponse, HTTPValidationError]]:
    """Delete File

     Delete a specific file.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file_path: Path of the file to delete
        service: App service instance
        api_key: API key for authentication

    Returns:
        Success confirmation

    Raises:
        400: Validation error
        404: File not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        file_path (str): Path of the file to delete

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            file_path=file_path,
            client=client,
        )
    ).parsed
