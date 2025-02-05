import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.log_level import LogLevel
from ..models.log_source import LogSource
from ..types import UNSET, Unset

T = TypeVar("T", bound="LogQueryParams")


@_attrs_define
class LogQueryParams:
    """Parameters for querying logs.

    Attributes:
        start_time (Union[None, Unset, datetime.datetime]): Start time for log query
        end_time (Union[None, Unset, datetime.datetime]): End time for log query
        level (Union[LogLevel, None, Unset]): Filter by log level
        source (Union[LogSource, None, Unset]): Filter by log source
        app_name (Union[None, Unset, str]): Filter by application name
        message_contains (Union[None, Unset, str]): Filter by message content
        limit (Union[Unset, int]): Maximum number of entries to return Default: 100.
        offset (Union[Unset, int]): Number of entries to skip Default: 0.
        sort_order (Union[Unset, str]): Sort order by timestamp Default: 'desc'.
        request_id (Union[None, Unset, str]): Filter by request ID
        session_id (Union[None, Unset, str]): Filter by session ID
        user_id (Union[None, Unset, str]): Filter by user ID
    """

    start_time: Union[None, Unset, datetime.datetime] = UNSET
    end_time: Union[None, Unset, datetime.datetime] = UNSET
    level: Union[LogLevel, None, Unset] = UNSET
    source: Union[LogSource, None, Unset] = UNSET
    app_name: Union[None, Unset, str] = UNSET
    message_contains: Union[None, Unset, str] = UNSET
    limit: Union[Unset, int] = 100
    offset: Union[Unset, int] = 0
    sort_order: Union[Unset, str] = "desc"
    request_id: Union[None, Unset, str] = UNSET
    session_id: Union[None, Unset, str] = UNSET
    user_id: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start_time: Union[None, Unset, str]
        if isinstance(self.start_time, Unset):
            start_time = UNSET
        elif isinstance(self.start_time, datetime.datetime):
            start_time = self.start_time.isoformat()
        else:
            start_time = self.start_time

        end_time: Union[None, Unset, str]
        if isinstance(self.end_time, Unset):
            end_time = UNSET
        elif isinstance(self.end_time, datetime.datetime):
            end_time = self.end_time.isoformat()
        else:
            end_time = self.end_time

        level: Union[None, Unset, str]
        if isinstance(self.level, Unset):
            level = UNSET
        elif isinstance(self.level, LogLevel):
            level = self.level.value
        else:
            level = self.level

        source: Union[None, Unset, str]
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, LogSource):
            source = self.source.value
        else:
            source = self.source

        app_name: Union[None, Unset, str]
        if isinstance(self.app_name, Unset):
            app_name = UNSET
        else:
            app_name = self.app_name

        message_contains: Union[None, Unset, str]
        if isinstance(self.message_contains, Unset):
            message_contains = UNSET
        else:
            message_contains = self.message_contains

        limit = self.limit

        offset = self.offset

        sort_order = self.sort_order

        request_id: Union[None, Unset, str]
        if isinstance(self.request_id, Unset):
            request_id = UNSET
        else:
            request_id = self.request_id

        session_id: Union[None, Unset, str]
        if isinstance(self.session_id, Unset):
            session_id = UNSET
        else:
            session_id = self.session_id

        user_id: Union[None, Unset, str]
        if isinstance(self.user_id, Unset):
            user_id = UNSET
        else:
            user_id = self.user_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if start_time is not UNSET:
            field_dict["start_time"] = start_time
        if end_time is not UNSET:
            field_dict["end_time"] = end_time
        if level is not UNSET:
            field_dict["level"] = level
        if source is not UNSET:
            field_dict["source"] = source
        if app_name is not UNSET:
            field_dict["app_name"] = app_name
        if message_contains is not UNSET:
            field_dict["message_contains"] = message_contains
        if limit is not UNSET:
            field_dict["limit"] = limit
        if offset is not UNSET:
            field_dict["offset"] = offset
        if sort_order is not UNSET:
            field_dict["sort_order"] = sort_order
        if request_id is not UNSET:
            field_dict["request_id"] = request_id
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if user_id is not UNSET:
            field_dict["user_id"] = user_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_start_time(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                start_time_type_0 = isoparse(data)

                return start_time_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        start_time = _parse_start_time(d.pop("start_time", UNSET))

        def _parse_end_time(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                end_time_type_0 = isoparse(data)

                return end_time_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        end_time = _parse_end_time(d.pop("end_time", UNSET))

        def _parse_level(data: object) -> Union[LogLevel, None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                level_type_0 = LogLevel(data)

                return level_type_0
            except:  # noqa: E722
                pass
            return cast(Union[LogLevel, None, Unset], data)

        level = _parse_level(d.pop("level", UNSET))

        def _parse_source(data: object) -> Union[LogSource, None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                source_type_0 = LogSource(data)

                return source_type_0
            except:  # noqa: E722
                pass
            return cast(Union[LogSource, None, Unset], data)

        source = _parse_source(d.pop("source", UNSET))

        def _parse_app_name(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        app_name = _parse_app_name(d.pop("app_name", UNSET))

        def _parse_message_contains(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        message_contains = _parse_message_contains(d.pop("message_contains", UNSET))

        limit = d.pop("limit", UNSET)

        offset = d.pop("offset", UNSET)

        sort_order = d.pop("sort_order", UNSET)

        def _parse_request_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        request_id = _parse_request_id(d.pop("request_id", UNSET))

        def _parse_session_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        session_id = _parse_session_id(d.pop("session_id", UNSET))

        def _parse_user_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        user_id = _parse_user_id(d.pop("user_id", UNSET))

        log_query_params = cls(
            start_time=start_time,
            end_time=end_time,
            level=level,
            source=source,
            app_name=app_name,
            message_contains=message_contains,
            limit=limit,
            offset=offset,
            sort_order=sort_order,
            request_id=request_id,
            session_id=session_id,
            user_id=user_id,
        )

        log_query_params.additional_properties = d
        return log_query_params

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
