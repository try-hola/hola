from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_app_action_response import ApiResponseAppActionResponse
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
) -> dict[str, Any]:
    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/apps/{app_name}/stop",
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseAppActionResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
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
) -> Response[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
    """Stop App

     Stop an application.

    Gracefully stops a running application.

    Args:
        app_name: Name of the application to stop
        service: App service instance
        api_key: API key for authentication

    Returns:
        Action response with status change information

    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be stopped
        500: Internal server error - stop operation failed

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppActionResponse, HTTPValidationError]]
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
) -> Optional[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
    """Stop App

     Stop an application.

    Gracefully stops a running application.

    Args:
        app_name: Name of the application to stop
        service: App service instance
        api_key: API key for authentication

    Returns:
        Action response with status change information

    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be stopped
        500: Internal server error - stop operation failed

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppActionResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
) -> Response[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
    """Stop App

     Stop an application.

    Gracefully stops a running application.

    Args:
        app_name: Name of the application to stop
        service: App service instance
        api_key: API key for authentication

    Returns:
        Action response with status change information

    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be stopped
        500: Internal server error - stop operation failed

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppActionResponse, HTTPValidationError]]
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
) -> Optional[Union[ApiResponseAppActionResponse, HTTPValidationError]]:
    """Stop App

     Stop an application.

    Gracefully stops a running application.

    Args:
        app_name: Name of the application to stop
        service: App service instance
        api_key: API key for authentication

    Returns:
        Action response with status change information

    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be stopped
        500: Internal server error - stop operation failed

    Args:
        app_name (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppActionResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
        )
    ).parsed
