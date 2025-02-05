import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.metric_point_labels import MetricPointLabels


T = TypeVar("T", bound="MetricPoint")


@_attrs_define
class MetricPoint:
    """Single metric data point.

    Attributes:
        timestamp (datetime.datetime): Timestamp when metric was recorded
        value (float): Metric value
        labels (Union[Unset, MetricPointLabels]): Additional metric labels
    """

    timestamp: datetime.datetime
    value: float
    labels: Union[Unset, "MetricPointLabels"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp.isoformat()

        value = self.value

        labels: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "timestamp": timestamp,
                "value": value,
            }
        )
        if labels is not UNSET:
            field_dict["labels"] = labels

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.metric_point_labels import MetricPointLabels

        d = dict(src_dict)
        timestamp = isoparse(d.pop("timestamp"))

        value = d.pop("value")

        _labels = d.pop("labels", UNSET)
        labels: Union[Unset, MetricPointLabels]
        if isinstance(_labels, Unset):
            labels = UNSET
        else:
            labels = MetricPointLabels.from_dict(_labels)

        metric_point = cls(
            timestamp=timestamp,
            value=value,
            labels=labels,
        )

        metric_point.additional_properties = d
        return metric_point

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
