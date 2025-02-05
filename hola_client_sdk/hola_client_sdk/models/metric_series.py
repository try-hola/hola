import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.metric_type import MetricType
from ..models.metric_unit import MetricUnit
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.metric_point import MetricPoint


T = TypeVar("T", bound="MetricSeries")


@_attrs_define
class MetricSeries:
    """Time series of metric data points.

    Attributes:
        name (str): Metric name
        type_ (MetricType): Metric type enumeration.
        unit (MetricUnit): Metric unit enumeration.
        app_name (str): Associated application name
        points (list['MetricPoint']): List of metric data points
        count (int): Number of data points
        description (Union[None, Unset, str]): Metric description
        min_value (Union[None, Unset, float]): Minimum value in series
        max_value (Union[None, Unset, float]): Maximum value in series
        avg_value (Union[None, Unset, float]): Average value in series
        sum_value (Union[None, Unset, float]): Sum of all values
        start_time (Union[None, Unset, datetime.datetime]): First data point timestamp
        end_time (Union[None, Unset, datetime.datetime]): Last data point timestamp
    """

    name: str
    type_: MetricType
    unit: MetricUnit
    app_name: str
    points: list["MetricPoint"]
    count: int
    description: Union[None, Unset, str] = UNSET
    min_value: Union[None, Unset, float] = UNSET
    max_value: Union[None, Unset, float] = UNSET
    avg_value: Union[None, Unset, float] = UNSET
    sum_value: Union[None, Unset, float] = UNSET
    start_time: Union[None, Unset, datetime.datetime] = UNSET
    end_time: Union[None, Unset, datetime.datetime] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        unit = self.unit.value

        app_name = self.app_name

        points = []
        for points_item_data in self.points:
            points_item = points_item_data.to_dict()
            points.append(points_item)

        count = self.count

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        min_value: Union[None, Unset, float]
        if isinstance(self.min_value, Unset):
            min_value = UNSET
        else:
            min_value = self.min_value

        max_value: Union[None, Unset, float]
        if isinstance(self.max_value, Unset):
            max_value = UNSET
        else:
            max_value = self.max_value

        avg_value: Union[None, Unset, float]
        if isinstance(self.avg_value, Unset):
            avg_value = UNSET
        else:
            avg_value = self.avg_value

        sum_value: Union[None, Unset, float]
        if isinstance(self.sum_value, Unset):
            sum_value = UNSET
        else:
            sum_value = self.sum_value

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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
                "unit": unit,
                "app_name": app_name,
                "points": points,
                "count": count,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if min_value is not UNSET:
            field_dict["min_value"] = min_value
        if max_value is not UNSET:
            field_dict["max_value"] = max_value
        if avg_value is not UNSET:
            field_dict["avg_value"] = avg_value
        if sum_value is not UNSET:
            field_dict["sum_value"] = sum_value
        if start_time is not UNSET:
            field_dict["start_time"] = start_time
        if end_time is not UNSET:
            field_dict["end_time"] = end_time

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.metric_point import MetricPoint

        d = dict(src_dict)
        name = d.pop("name")

        type_ = MetricType(d.pop("type"))

        unit = MetricUnit(d.pop("unit"))

        app_name = d.pop("app_name")

        points = []
        _points = d.pop("points")
        for points_item_data in _points:
            points_item = MetricPoint.from_dict(points_item_data)

            points.append(points_item)

        count = d.pop("count")

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_min_value(data: object) -> Union[None, Unset, float]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, float], data)

        min_value = _parse_min_value(d.pop("min_value", UNSET))

        def _parse_max_value(data: object) -> Union[None, Unset, float]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, float], data)

        max_value = _parse_max_value(d.pop("max_value", UNSET))

        def _parse_avg_value(data: object) -> Union[None, Unset, float]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, float], data)

        avg_value = _parse_avg_value(d.pop("avg_value", UNSET))

        def _parse_sum_value(data: object) -> Union[None, Unset, float]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, float], data)

        sum_value = _parse_sum_value(d.pop("sum_value", UNSET))

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

        metric_series = cls(
            name=name,
            type_=type_,
            unit=unit,
            app_name=app_name,
            points=points,
            count=count,
            description=description,
            min_value=min_value,
            max_value=max_value,
            avg_value=avg_value,
            sum_value=sum_value,
            start_time=start_time,
            end_time=end_time,
        )

        metric_series.additional_properties = d
        return metric_series

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
