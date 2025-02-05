import datetime
from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_dictstr_any import ApiResponseDictstrAny
from ...models.http_validation_error import HTTPValidationError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    app_name: str,
    *,
    metric_names: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    aggregation: Union[None, Unset, str] = "avg",
    metric_type: Union[None, Unset, str] = UNSET,
    interval: Union[None, Unset, str] = UNSET,
    limit: Union[Unset, int] = 1000,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    json_metric_names: Union[None, Unset, str]
    if isinstance(metric_names, Unset):
        json_metric_names = UNSET
    else:
        json_metric_names = metric_names
    params["metric_names"] = json_metric_names

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

    json_aggregation: Union[None, Unset, str]
    if isinstance(aggregation, Unset):
        json_aggregation = UNSET
    else:
        json_aggregation = aggregation
    params["aggregation"] = json_aggregation

    json_metric_type: Union[None, Unset, str]
    if isinstance(metric_type, Unset):
        json_metric_type = UNSET
    else:
        json_metric_type = metric_type
    params["metric_type"] = json_metric_type

    json_interval: Union[None, Unset, str]
    if isinstance(interval, Unset):
        json_interval = UNSET
    else:
        json_interval = interval
    params["interval"] = json_interval

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": f"/api/apps/{app_name}/metrics",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseDictstrAny.from_dict(response.json())

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
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
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
    metric_names: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    aggregation: Union[None, Unset, str] = "avg",
    metric_type: Union[None, Unset, str] = UNSET,
    interval: Union[None, Unset, str] = UNSET,
    limit: Union[Unset, int] = 1000,
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Get Metrics

     Get metrics for an application with filtering and aggregation.

    Args:
        app_name (str):
        metric_names (Union[None, Unset, str]): Comma-separated metric names
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        aggregation (Union[None, Unset, str]): Aggregation function (avg, sum, min, max, count)
            Default: 'avg'.
        metric_type (Union[None, Unset, str]): Filter by metric type (counter, gauge, histogram,
            timer)
        interval (Union[None, Unset, str]): Aggregation interval (1m, 5m, 1h, etc.)
        limit (Union[Unset, int]): Maximum number of points per series Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseDictstrAny, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        metric_names=metric_names,
        start_time=start_time,
        end_time=end_time,
        aggregation=aggregation,
        metric_type=metric_type,
        interval=interval,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
    metric_names: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    aggregation: Union[None, Unset, str] = "avg",
    metric_type: Union[None, Unset, str] = UNSET,
    interval: Union[None, Unset, str] = UNSET,
    limit: Union[Unset, int] = 1000,
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Get Metrics

     Get metrics for an application with filtering and aggregation.

    Args:
        app_name (str):
        metric_names (Union[None, Unset, str]): Comma-separated metric names
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        aggregation (Union[None, Unset, str]): Aggregation function (avg, sum, min, max, count)
            Default: 'avg'.
        metric_type (Union[None, Unset, str]): Filter by metric type (counter, gauge, histogram,
            timer)
        interval (Union[None, Unset, str]): Aggregation interval (1m, 5m, 1h, etc.)
        limit (Union[Unset, int]): Maximum number of points per series Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseDictstrAny, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
        metric_names=metric_names,
        start_time=start_time,
        end_time=end_time,
        aggregation=aggregation,
        metric_type=metric_type,
        interval=interval,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    metric_names: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    aggregation: Union[None, Unset, str] = "avg",
    metric_type: Union[None, Unset, str] = UNSET,
    interval: Union[None, Unset, str] = UNSET,
    limit: Union[Unset, int] = 1000,
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Get Metrics

     Get metrics for an application with filtering and aggregation.

    Args:
        app_name (str):
        metric_names (Union[None, Unset, str]): Comma-separated metric names
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        aggregation (Union[None, Unset, str]): Aggregation function (avg, sum, min, max, count)
            Default: 'avg'.
        metric_type (Union[None, Unset, str]): Filter by metric type (counter, gauge, histogram,
            timer)
        interval (Union[None, Unset, str]): Aggregation interval (1m, 5m, 1h, etc.)
        limit (Union[Unset, int]): Maximum number of points per series Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseDictstrAny, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        metric_names=metric_names,
        start_time=start_time,
        end_time=end_time,
        aggregation=aggregation,
        metric_type=metric_type,
        interval=interval,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
    metric_names: Union[None, Unset, str] = UNSET,
    start_time: Union[None, Unset, datetime.datetime] = UNSET,
    end_time: Union[None, Unset, datetime.datetime] = UNSET,
    aggregation: Union[None, Unset, str] = "avg",
    metric_type: Union[None, Unset, str] = UNSET,
    interval: Union[None, Unset, str] = UNSET,
    limit: Union[Unset, int] = 1000,
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Get Metrics

     Get metrics for an application with filtering and aggregation.

    Args:
        app_name (str):
        metric_names (Union[None, Unset, str]): Comma-separated metric names
        start_time (Union[None, Unset, datetime.datetime]): Start time for filtering
        end_time (Union[None, Unset, datetime.datetime]): End time for filtering
        aggregation (Union[None, Unset, str]): Aggregation function (avg, sum, min, max, count)
            Default: 'avg'.
        metric_type (Union[None, Unset, str]): Filter by metric type (counter, gauge, histogram,
            timer)
        interval (Union[None, Unset, str]): Aggregation interval (1m, 5m, 1h, etc.)
        limit (Union[Unset, int]): Maximum number of points per series Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseDictstrAny, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            metric_names=metric_names,
            start_time=start_time,
            end_time=end_time,
            aggregation=aggregation,
            metric_type=metric_type,
            interval=interval,
            limit=limit,
        )
    ).parsed
