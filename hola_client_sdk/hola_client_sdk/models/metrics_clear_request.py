import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="MetricsClearRequest")


@_attrs_define
class MetricsClearRequest:
    """Request to clear metrics data.

    Attributes:
        app_name (Union[None, Unset, str]): Clear metrics for specific application
        metric_names (Union[None, Unset, list[str]]): Clear specific metrics
        before_time (Union[None, Unset, datetime.datetime]): Clear metrics before this timestamp
        older_than_days (Union[None, Unset, int]): Clear metrics older than this many days
    """

    app_name: Union[None, Unset, str] = UNSET
    metric_names: Union[None, Unset, list[str]] = UNSET
    before_time: Union[None, Unset, datetime.datetime] = UNSET
    older_than_days: Union[None, Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        app_name: Union[None, Unset, str]
        if isinstance(self.app_name, Unset):
            app_name = UNSET
        else:
            app_name = self.app_name

        metric_names: Union[None, Unset, list[str]]
        if isinstance(self.metric_names, Unset):
            metric_names = UNSET
        elif isinstance(self.metric_names, list):
            metric_names = self.metric_names

        else:
            metric_names = self.metric_names

        before_time: Union[None, Unset, str]
        if isinstance(self.before_time, Unset):
            before_time = UNSET
        elif isinstance(self.before_time, datetime.datetime):
            before_time = self.before_time.isoformat()
        else:
            before_time = self.before_time

        older_than_days: Union[None, Unset, int]
        if isinstance(self.older_than_days, Unset):
            older_than_days = UNSET
        else:
            older_than_days = self.older_than_days

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if app_name is not UNSET:
            field_dict["app_name"] = app_name
        if metric_names is not UNSET:
            field_dict["metric_names"] = metric_names
        if before_time is not UNSET:
            field_dict["before_time"] = before_time
        if older_than_days is not UNSET:
            field_dict["older_than_days"] = older_than_days

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_app_name(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        app_name = _parse_app_name(d.pop("app_name", UNSET))

        def _parse_metric_names(data: object) -> Union[None, Unset, list[str]]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metric_names_type_0 = cast(list[str], data)

                return metric_names_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, list[str]], data)

        metric_names = _parse_metric_names(d.pop("metric_names", UNSET))

        def _parse_before_time(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                before_time_type_0 = isoparse(data)

                return before_time_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        before_time = _parse_before_time(d.pop("before_time", UNSET))

        def _parse_older_than_days(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        older_than_days = _parse_older_than_days(d.pop("older_than_days", UNSET))

        metrics_clear_request = cls(
            app_name=app_name,
            metric_names=metric_names,
            before_time=before_time,
            older_than_days=older_than_days,
        )

        metrics_clear_request.additional_properties = d
        return metrics_clear_request

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
