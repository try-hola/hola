from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_backup_create_response import (
    ApiResponseBackupCreateResponse,
)
from ...models.backup_create_request import BackupCreateRequest
from ...models.http_validation_error import HTTPValidationError
from ...types import Response


def _get_kwargs(
    app_name: str,
    *,
    body: BackupCreateRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/apps/{app_name}/backups",
    }

    _body = body.to_dict()

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseBackupCreateResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
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
    body: BackupCreateRequest,
) -> Response[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
    """Create Backup

     Create a new backup for an application.

    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters

    Returns:
        Created backup information

    Args:
        app_name (str): Application name
        body (BackupCreateRequest): Request to create a new backup.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]
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
    body: BackupCreateRequest,
) -> Optional[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
    """Create Backup

     Create a new backup for an application.

    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters

    Returns:
        Created backup information

    Args:
        app_name (str): Application name
        body (BackupCreateRequest): Request to create a new backup.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseBackupCreateResponse, HTTPValidationError]
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
    body: BackupCreateRequest,
) -> Response[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
    """Create Backup

     Create a new backup for an application.

    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters

    Returns:
        Created backup information

    Args:
        app_name (str): Application name
        body (BackupCreateRequest): Request to create a new backup.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]
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
    body: BackupCreateRequest,
) -> Optional[Union[ApiResponseBackupCreateResponse, HTTPValidationError]]:
    """Create Backup

     Create a new backup for an application.

    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters

    Returns:
        Created backup information

    Args:
        app_name (str): Application name
        body (BackupCreateRequest): Request to create a new backup.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseBackupCreateResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            body=body,
        )
    ).parsed
