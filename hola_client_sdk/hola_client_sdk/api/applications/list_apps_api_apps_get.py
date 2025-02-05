from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_app_list_response import ApiResponseAppListResponse
from ...types import Response


def _get_kwargs() -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/apps/",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[ApiResponseAppListResponse]:
    if response.status_code == 200:
        response_200 = ApiResponseAppListResponse.from_dict(response.json())

        return response_200
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[ApiResponseAppListResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ApiResponseAppListResponse]:
    """List Apps

     List all deployed applications.

    Retrieves a list of all applications with their current status,
    health information, and metadata.

    Args:
        service: App service instance
        api_key: API key for authentication

    Returns:
        List of all applications with metadata

    Raises:
        500: Internal server error - failed to retrieve applications

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiResponseAppListResponse]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> Optional[ApiResponseAppListResponse]:
    """List Apps

     List all deployed applications.

    Retrieves a list of all applications with their current status,
    health information, and metadata.

    Args:
        service: App service instance
        api_key: API key for authentication

    Returns:
        List of all applications with metadata

    Raises:
        500: Internal server error - failed to retrieve applications

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiResponseAppListResponse
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ApiResponseAppListResponse]:
    """List Apps

     List all deployed applications.

    Retrieves a list of all applications with their current status,
    health information, and metadata.

    Args:
        service: App service instance
        api_key: API key for authentication

    Returns:
        List of all applications with metadata

    Raises:
        500: Internal server error - failed to retrieve applications

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiResponseAppListResponse]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> Optional[ApiResponseAppListResponse]:
    """List Apps

     List all deployed applications.

    Retrieves a list of all applications with their current status,
    health information, and metadata.

    Args:
        service: App service instance
        api_key: API key for authentication

    Returns:
        List of all applications with metadata

    Raises:
        500: Internal server error - failed to retrieve applications

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiResponseAppListResponse
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
