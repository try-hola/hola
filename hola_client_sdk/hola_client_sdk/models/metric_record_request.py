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
    from ..models.metric_record_request_labels import MetricRecordRequestLabels


T = TypeVar("T", bound="MetricRecordRequest")


@_attrs_define
class MetricRecordRequest:
    """Request to record a new metric data point.

    Attributes:
        name (str): Metric name
        value (float): Metric value
        type_ (Union[Unset, MetricType]): Metric type enumeration.
        unit (Union[Unset, MetricUnit]): Metric unit enumeration.
        description (Union[None, Unset, str]): Metric description
        labels (Union[Unset, MetricRecordRequestLabels]): Additional metric labels
        timestamp (Union[None, Unset, datetime.datetime]): Custom timestamp (defaults to current time)
    """

    name: str
    value: float
    type_: Union[Unset, MetricType] = UNSET
    unit: Union[Unset, MetricUnit] = UNSET
    description: Union[None, Unset, str] = UNSET
    labels: Union[Unset, "MetricRecordRequestLabels"] = UNSET
    timestamp: Union[None, Unset, datetime.datetime] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        value = self.value

        type_: Union[Unset, str] = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        unit: Union[Unset, str] = UNSET
        if not isinstance(self.unit, Unset):
            unit = self.unit.value

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        labels: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels.to_dict()

        timestamp: Union[None, Unset, str]
        if isinstance(self.timestamp, Unset):
            timestamp = UNSET
        elif isinstance(self.timestamp, datetime.datetime):
            timestamp = self.timestamp.isoformat()
        else:
            timestamp = self.timestamp

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "value": value,
            }
        )
        if type_ is not UNSET:
            field_dict["type"] = type_
        if unit is not UNSET:
            field_dict["unit"] = unit
        if description is not UNSET:
            field_dict["description"] = description
        if labels is not UNSET:
            field_dict["labels"] = labels
        if timestamp is not UNSET:
            field_dict["timestamp"] = timestamp

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.metric_record_request_labels import MetricRecordRequestLabels

        d = dict(src_dict)
        name = d.pop("name")

        value = d.pop("value")

        _type_ = d.pop("type", UNSET)
        type_: Union[Unset, MetricType]
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = MetricType(_type_)

        _unit = d.pop("unit", UNSET)
        unit: Union[Unset, MetricUnit]
        if isinstance(_unit, Unset):
            unit = UNSET
        else:
            unit = MetricUnit(_unit)

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        _labels = d.pop("labels", UNSET)
        labels: Union[Unset, MetricRecordRequestLabels]
        if isinstance(_labels, Unset):
            labels = UNSET
        else:
            labels = MetricRecordRequestLabels.from_dict(_labels)

        def _parse_timestamp(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                timestamp_type_0 = isoparse(data)

                return timestamp_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        timestamp = _parse_timestamp(d.pop("timestamp", UNSET))

        metric_record_request = cls(
            name=name,
            value=value,
            type_=type_,
            unit=unit,
            description=description,
            labels=labels,
            timestamp=timestamp,
        )

        metric_record_request.additional_properties = d
        return metric_record_request

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
