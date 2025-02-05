from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_config_response import ApiResponseConfigResponse
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/config/{app_name}",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseConfigResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseConfigResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseConfigResponse, HTTPValidationError]]:
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
) -> Response[Union[ApiResponseConfigResponse, HTTPValidationError]]:
    """Get App Config

     Get all configuration for an application.

    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration response with app config

    Raises:
        400: Validation error - invalid app name
        404: Application not found
        500: Internal server error

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponseConfigResponse, HTTPValidationError]]:
    """Get App Config

     Get all configuration for an application.

    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration response with app config

    Raises:
        400: Validation error - invalid app name
        404: Application not found
        500: Internal server error

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponseConfigResponse, HTTPValidationError]]:
    """Get App Config

     Get all configuration for an application.

    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration response with app config

    Raises:
        400: Validation error - invalid app name
        404: Application not found
        500: Internal server error

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseConfigResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
) -> Optional[Union[ApiResponseConfigResponse, HTTPValidationError]]:
    """Get App Config

     Get all configuration for an application.

    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        api_key: API key for authentication

    Returns:
        Configuration response with app config

    Raises:
        400: Validation error - invalid app name
        404: Application not found
        500: Internal server error

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseConfigResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
        )
    ).parsed
