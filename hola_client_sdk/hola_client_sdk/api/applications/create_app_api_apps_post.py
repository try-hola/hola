from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_app_create_response import ApiResponseAppCreateResponse
from ...models.app_create_request import AppCreateRequest
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    *,
    body: AppCreateRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/apps/",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseAppCreateResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: AppCreateRequest,
) -> Response[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    """Create App

     Create a new application without deploying it.

    Creates a new application in CREATED status that can be deployed later.
    This allows setting up application configuration before actual deployment.

    Args:
        request: Application creation configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Creation response with app details

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - creation process failed

    Args:
        body (AppCreateRequest): Request model for creating applications (without deployment).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppCreateResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: AppCreateRequest,
) -> Optional[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    """Create App

     Create a new application without deploying it.

    Creates a new application in CREATED status that can be deployed later.
    This allows setting up application configuration before actual deployment.

    Args:
        request: Application creation configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Creation response with app details

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - creation process failed

    Args:
        body (AppCreateRequest): Request model for creating applications (without deployment).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppCreateResponse, HTTPValidationError]
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: AppCreateRequest,
) -> Response[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    """Create App

     Create a new application without deploying it.

    Creates a new application in CREATED status that can be deployed later.
    This allows setting up application configuration before actual deployment.

    Args:
        request: Application creation configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Creation response with app details

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - creation process failed

    Args:
        body (AppCreateRequest): Request model for creating applications (without deployment).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppCreateResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: AppCreateRequest,
) -> Optional[Union[ApiResponseAppCreateResponse, HTTPValidationError]]:
    """Create App

     Create a new application without deploying it.

    Creates a new application in CREATED status that can be deployed later.
    This allows setting up application configuration before actual deployment.

    Args:
        request: Application creation configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Creation response with app details

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - creation process failed

    Args:
        body (AppCreateRequest): Request model for creating applications (without deployment).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppCreateResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
