from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_app_deploy_response import ApiResponseAppDeployResponse
from ...models.app_upgrade_request import AppUpgradeRequest
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
    *,
    body: AppUpgradeRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/apps/{app_name}/upgrade",
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
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: AppUpgradeRequest,
) -> Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Upgrade App

     Upgrade an application.

    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.

    Args:
        app_name: Name of the application to upgrade
        request: Upgrade configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Upgrade response with updated app details

    Raises:
        404: Application not found
        422: Validation error - invalid configuration
        500: Internal server error - upgrade process failed

    Args:
        app_name (str):
        body (AppUpgradeRequest): Request model for upgrading applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]
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
    body: AppUpgradeRequest,
) -> Optional[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Upgrade App

     Upgrade an application.

    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.

    Args:
        app_name: Name of the application to upgrade
        request: Upgrade configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Upgrade response with updated app details

    Raises:
        404: Application not found
        422: Validation error - invalid configuration
        500: Internal server error - upgrade process failed

    Args:
        app_name (str):
        body (AppUpgradeRequest): Request model for upgrading applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppDeployResponse, HTTPValidationError]
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
    body: AppUpgradeRequest,
) -> Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Upgrade App

     Upgrade an application.

    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.

    Args:
        app_name: Name of the application to upgrade
        request: Upgrade configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Upgrade response with updated app details

    Raises:
        404: Application not found
        422: Validation error - invalid configuration
        500: Internal server error - upgrade process failed

    Args:
        app_name (str):
        body (AppUpgradeRequest): Request model for upgrading applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseAppDeployResponse, HTTPValidationError]]
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
    body: AppUpgradeRequest,
) -> Optional[Union[ApiResponseAppDeployResponse, HTTPValidationError]]:
    """Upgrade App

     Upgrade an application.

    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.

    Args:
        app_name: Name of the application to upgrade
        request: Upgrade configuration
        service: App service instance
        api_key: API key for authentication

    Returns:
        Upgrade response with updated app details

    Raises:
        404: Application not found
        422: Validation error - invalid configuration
        500: Internal server error - upgrade process failed

    Args:
        app_name (str):
        body (AppUpgradeRequest): Request model for upgrading applications.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseAppDeployResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            body=body,
        )
    ).parsed
