from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_file_info import ApiResponseFileInfo
from ...models.body_upload_file_api_apps_app_name_files_post import (
    BodyUploadFileApiAppsAppNameFilesPost,
)
from ...models.http_validation_error import HTTPValidationError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    app_name: str,
    *,
    body: BodyUploadFileApiAppsAppNameFilesPost,
    path: Union[None, Unset, str] = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    json_path: Union[None, Unset, str]
    if isinstance(path, Unset):
        json_path = UNSET
    else:
        json_path = path
    params["path"] = json_path

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": f"/api/apps/{app_name}/files/",
        "params": params,
    }

    _body = body.to_multipart()

    _kwargs["files"] = _body

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseFileInfo, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseFileInfo.from_dict(response.json())

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
) -> Response[Union[ApiResponseFileInfo, HTTPValidationError]]:
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
    body: BodyUploadFileApiAppsAppNameFilesPost,
    path: Union[None, Unset, str] = UNSET,
) -> Response[Union[ApiResponseFileInfo, HTTPValidationError]]:
    """Upload File

     Upload a file for the application.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file: File to upload
        path: Target path within the application's file storage
        service: App service instance
        api_key: API key for authentication

    Returns:
        Information about the uploaded file

    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        path (Union[None, Unset, str]):
        body (BodyUploadFileApiAppsAppNameFilesPost):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseFileInfo, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
        path=path,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: BodyUploadFileApiAppsAppNameFilesPost,
    path: Union[None, Unset, str] = UNSET,
) -> Optional[Union[ApiResponseFileInfo, HTTPValidationError]]:
    """Upload File

     Upload a file for the application.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file: File to upload
        path: Target path within the application's file storage
        service: App service instance
        api_key: API key for authentication

    Returns:
        Information about the uploaded file

    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        path (Union[None, Unset, str]):
        body (BodyUploadFileApiAppsAppNameFilesPost):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseFileInfo, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
        body=body,
        path=path,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: BodyUploadFileApiAppsAppNameFilesPost,
    path: Union[None, Unset, str] = UNSET,
) -> Response[Union[ApiResponseFileInfo, HTTPValidationError]]:
    """Upload File

     Upload a file for the application.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file: File to upload
        path: Target path within the application's file storage
        service: App service instance
        api_key: API key for authentication

    Returns:
        Information about the uploaded file

    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        path (Union[None, Unset, str]):
        body (BodyUploadFileApiAppsAppNameFilesPost):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseFileInfo, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
        path=path,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: BodyUploadFileApiAppsAppNameFilesPost,
    path: Union[None, Unset, str] = UNSET,
) -> Optional[Union[ApiResponseFileInfo, HTTPValidationError]]:
    """Upload File

     Upload a file for the application.

    Args:
        request: FastAPI request object
        app_name: Name of the application
        file: File to upload
        path: Target path within the application's file storage
        service: App service instance
        api_key: API key for authentication

    Returns:
        Information about the uploaded file

    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error

    Args:
        app_name (str): Name of the application
        path (Union[None, Unset, str]):
        body (BodyUploadFileApiAppsAppNameFilesPost):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseFileInfo, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            body=body,
            path=path,
        )
    ).parsed
