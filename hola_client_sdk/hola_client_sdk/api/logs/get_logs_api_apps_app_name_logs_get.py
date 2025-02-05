import datetime
from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_log_response import ApiResponseLogResponse
from ...models.http_validation_error import HTTPValidationError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    app_name: str,
    *,
    level: Union[None, Unset, str] = UNSET,
    source: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    limit: Union[Unset, int] = 100,
    offset: Union[Unset, int] = 0,
    search: Union[None, Unset, str] = UNSET,
    request_id: Union[None, Unset, str] = UNSET,
    session_id: Union[None, Unset, str] = UNSET,
    user_id: Union[None, Unset, str] = UNSET,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    json_level: Union[None, Unset, str]
    if isinstance(level, Unset):
        json_level = UNSET
    else:
        json_level = level
    params["level"] = json_level

    json_source: Union[None, Unset, str]
    if isinstance(source, Unset):
        json_source = UNSET
    else:
        json_source = source
    params["source"] = json_source

    json_start_time: Union[None, Unset, str]
    if isinstance(start_time, Unset):
        json_start_time = UNSET
    elif isinstance(start_time, datetime.datetime):
        json_start_time = start_time.isoformat()
    else:
        json_start_time = start_time
    params["start_time"] = json_start_time

    json_end_time: Union[None, Unset, str]
    if isinstance(end_time, Unset):
        json_end_time = UNSET
    elif isinstance(end_time, datetime.datetime):
        json_end_time = end_time.isoformat()
    else:
        json_end_time = end_time
    params["end_time"] = json_end_time

    params["limit"] = limit

    params["offset"] = offset

    json_search: Union[None, Unset, str]
    if isinstance(search, Unset):
        json_search = UNSET
    else:
        json_search = search
    params["search"] = json_search

    json_request_id: Union[None, Unset, str]
    if isinstance(request_id, Unset):
        json_request_id = UNSET
    else:
        json_request_id = request_id
    params["request_id"] = json_request_id

    json_session_id: Union[None, Unset, str]
    if isinstance(session_id, Unset):
        json_session_id = UNSET
    else:
        json_session_id = session_id
    params["session_id"] = json_session_id

    json_user_id: Union[None, Unset, str]
    if isinstance(user_id, Unset):
        json_user_id = UNSET
    else:
        json_user_id = user_id
    params["user_id"] = json_user_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/apps/{app_name}/logs",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseLogResponse, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseLogResponse.from_dict(response.json())

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
) -> Response[Union[ApiResponseLogResponse, HTTPValidationError]]:
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
    level: Union[None, Unset, str] = UNSET,
    source: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    limit: Union[Unset, int] = 100,
    offset: Union[Unset, int] = 0,
    search: Union[None, Unset, str] = UNSET,
    request_id: Union[None, Unset, str] = UNSET,
    session_id: Union[None, Unset, str] = UNSET,
    user_id: Union[None, Unset, str] = UNSET,
) -> Response[Union[ApiResponseLogResponse, HTTPValidationError]]:
    """Get Logs

     Get logs for an application with filtering and pagination.

    Args:
        app_name (str):
        level (Union[None, Unset, str]): Filter by log level
        source (Union[None, Unset, str]): Filter by log source
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        limit (Union[Unset, int]): Number of logs to return Default: 100.
        offset (Union[Unset, int]): Number of logs to skip Default: 0.
        search (Union[None, Unset, str]): Search term in log messages
        request_id (Union[None, Unset, str]): Filter by request ID
        session_id (Union[None, Unset, str]): Filter by session ID
        user_id (Union[None, Unset, str]): Filter by user ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseLogResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        level=level,
        source=source,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
        search=search,
        request_id=request_id,
        session_id=session_id,
        user_id=user_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
    level: Union[None, Unset, str] = UNSET,
    source: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    limit: Union[Unset, int] = 100,
    offset: Union[Unset, int] = 0,
    search: Union[None, Unset, str] = UNSET,
    request_id: Union[None, Unset, str] = UNSET,
    session_id: Union[None, Unset, str] = UNSET,
    user_id: Union[None, Unset, str] = UNSET,
) -> Optional[Union[ApiResponseLogResponse, HTTPValidationError]]:
    """Get Logs

     Get logs for an application with filtering and pagination.

    Args:
        app_name (str):
        level (Union[None, Unset, str]): Filter by log level
        source (Union[None, Unset, str]): Filter by log source
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        limit (Union[Unset, int]): Number of logs to return Default: 100.
        offset (Union[Unset, int]): Number of logs to skip Default: 0.
        search (Union[None, Unset, str]): Search term in log messages
        request_id (Union[None, Unset, str]): Filter by request ID
        session_id (Union[None, Unset, str]): Filter by session ID
        user_id (Union[None, Unset, str]): Filter by user ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseLogResponse, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
        level=level,
        source=source,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
        search=search,
        request_id=request_id,
        session_id=session_id,
        user_id=user_id,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    level: Union[None, Unset, str] = UNSET,
    source: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    limit: Union[Unset, int] = 100,
    offset: Union[Unset, int] = 0,
    search: Union[None, Unset, str] = UNSET,
    request_id: Union[None, Unset, str] = UNSET,
    session_id: Union[None, Unset, str] = UNSET,
    user_id: Union[None, Unset, str] = UNSET,
) -> Response[Union[ApiResponseLogResponse, HTTPValidationError]]:
    """Get Logs

     Get logs for an application with filtering and pagination.

    Args:
        app_name (str):
        level (Union[None, Unset, str]): Filter by log level
        source (Union[None, Unset, str]): Filter by log source
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        limit (Union[Unset, int]): Number of logs to return Default: 100.
        offset (Union[Unset, int]): Number of logs to skip Default: 0.
        search (Union[None, Unset, str]): Search term in log messages
        request_id (Union[None, Unset, str]): Filter by request ID
        session_id (Union[None, Unset, str]): Filter by session ID
        user_id (Union[None, Unset, str]): Filter by user ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseLogResponse, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        level=level,
        source=source,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
        search=search,
        request_id=request_id,
        session_id=session_id,
        user_id=user_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
    level: Union[None, Unset, str] = UNSET,
    source: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    limit: Union[Unset, int] = 100,
    offset: Union[Unset, int] = 0,
    search: Union[None, Unset, str] = UNSET,
    request_id: Union[None, Unset, str] = UNSET,
    session_id: Union[None, Unset, str] = UNSET,
    user_id: Union[None, Unset, str] = UNSET,
) -> Optional[Union[ApiResponseLogResponse, HTTPValidationError]]:
    """Get Logs

     Get logs for an application with filtering and pagination.

    Args:
        app_name (str):
        level (Union[None, Unset, str]): Filter by log level
        source (Union[None, Unset, str]): Filter by log source
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        limit (Union[Unset, int]): Number of logs to return Default: 100.
        offset (Union[Unset, int]): Number of logs to skip Default: 0.
        search (Union[None, Unset, str]): Search term in log messages
        request_id (Union[None, Unset, str]): Filter by request ID
        session_id (Union[None, Unset, str]): Filter by session ID
        user_id (Union[None, Unset, str]): Filter by user ID

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseLogResponse, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            level=level,
            source=source,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
            search=search,
            request_id=request_id,
            session_id=session_id,
            user_id=user_id,
        )
    ).parsed
