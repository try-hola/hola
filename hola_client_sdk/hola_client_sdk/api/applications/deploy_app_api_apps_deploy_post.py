from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_app_deploy_response import ApiResponseAppDeployResponse
from ...models.app_deploy_request import AppDeployRequest
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    *,
    body: AppDeployRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/apps/deploy",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseAppDeployResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: AppDeployRequest,
) -> Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Deploy App

     Deploy a new application.

    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.

    Args:
        request: Application deployment configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Deployment response with app details and deployment ID

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - deployment process failed

    Args:
        body (AppDeployRequest): Request model for deploying applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]
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
    body: AppDeployRequest,
) -> Optional[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Deploy App

     Deploy a new application.

    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.

    Args:
        request: Application deployment configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Deployment response with app details and deployment ID

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - deployment process failed

    Args:
        body (AppDeployRequest): Request model for deploying applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppDeployResponse, HTTPValidationError]
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: AppDeployRequest,
) -> Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Deploy App

     Deploy a new application.

    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.

    Args:
        request: Application deployment configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Deployment response with app details and deployment ID

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - deployment process failed

    Args:
        body (AppDeployRequest): Request model for deploying applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: AppDeployRequest,
) -> Optional[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Deploy App

     Deploy a new application.

    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.

    Args:
        request: Application deployment configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Deployment response with app details and deployment ID

    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - deployment process failed

    Args:
        body (AppDeployRequest): Request model for deploying applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppDeployResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
