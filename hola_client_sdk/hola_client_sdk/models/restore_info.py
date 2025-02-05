import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.restore_status import RestoreStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="RestoreInfo")


@_attrs_define
class RestoreInfo:
    """Information about a restore operation.

    Attributes:
        id (str): Unique restore operation identifier
        backup_id (str): ID of backup being restored
        app_name (str): Name of application being restored
        target_app_name (str): Target application name
        status (RestoreStatus): Restore operation status enumeration.
        started_at (datetime.datetime): When the restore operation started
        completed_at (Union[None, Unset, datetime.datetime]): When the restore operation completed
        error_message (Union[None, Unset, str]): Error message if restore failed
        progress_message (Union[None, Unset, str]): Current progress message
    """

    id: str
    backup_id: str
    app_name: str
    target_app_name: str
    status: RestoreStatus
    started_at: datetime.datetime
    completed_at: Union[None, Unset, datetime.datetime] = UNSET
    error_message: Union[None, Unset, str] = UNSET
    progress_message: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        backup_id = self.backup_id

        app_name = self.app_name

        target_app_name = self.target_app_name

        status = self.status.value

        started_at = self.started_at.isoformat()

        completed_at: Union[None, Unset, str]
        if isinstance(self.completed_at, Unset):
            completed_at = UNSET
        elif isinstance(self.completed_at, datetime.datetime):
            completed_at = self.completed_at.isoformat()
        else:
            completed_at = self.completed_at

        error_message: Union[None, Unset, str]
        if isinstance(self.error_message, Unset):
            error_message = UNSET
        else:
            error_message = self.error_message

        progress_message: Union[None, Unset, str]
        if isinstance(self.progress_message, Unset):
            progress_message = UNSET
        else:
            progress_message = self.progress_message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "backup_id": backup_id,
                "app_name": app_name,
                "target_app_name": target_app_name,
                "status": status,
                "started_at": started_at,
            }
        )
        if completed_at is not UNSET:
            field_dict["completed_at"] = completed_at
        if error_message is not UNSET:
            field_dict["error_message"] = error_message
        if progress_message is not UNSET:
            field_dict["progress_message"] = progress_message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        backup_id = d.pop("backup_id")

        app_name = d.pop("app_name")

        target_app_name = d.pop("target_app_name")

        status = RestoreStatus(d.pop("status"))

        started_at = isoparse(d.pop("started_at"))

        def _parse_completed_at(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                completed_at_type_0 = isoparse(data)

                return completed_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        completed_at = _parse_completed_at(d.pop("completed_at", UNSET))

        def _parse_error_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        error_message = _parse_error_message(d.pop("error_message", UNSET))

        def _parse_progress_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        progress_message = _parse_progress_message(d.pop("progress_message", UNSET))

        restore_info = cls(
            id=id,
            backup_id=backup_id,
            app_name=app_name,
            target_app_name=target_app_name,
            status=status,
            started_at=started_at,
            completed_at=completed_at,
            error_message=error_message,
            progress_message=progress_message,
        )

        restore_info.additional_properties = d
        return restore_info

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
