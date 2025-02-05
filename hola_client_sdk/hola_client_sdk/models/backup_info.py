import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.backup_status import BackupStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="BackupInfo")


@_attrs_define
class BackupInfo:
    """Backup information and metadata.

    Attributes:
        id (str): Unique backup identifier
        app_name (str): Name of the application backed up
        status (BackupStatus): Backup status enumeration.
        created_at (datetime.datetime): When the backup was created
        server_version (str): Server version that created the backup
        description (Union[None, Unset, str]): Optional backup description
        size_bytes (Union[None, Unset, int]): Backup size in bytes
        completed_at (Union[None, Unset, datetime.datetime]): When the backup was completed
        error_message (Union[None, Unset, str]): Error message if backup failed
        includes_config (Union[Unset, bool]): Whether backup includes configuration Default: True.
        includes_files (Union[Unset, bool]): Whether backup includes application files Default: True.
        includes_data (Union[Unset, bool]): Whether backup includes application data Default: True.
        app_version (Union[None, Unset, str]): Application version at backup time
    """

    id: str
    app_name: str
    status: BackupStatus
    created_at: datetime.datetime
    server_version: str
    description: Union[None, Unset, str] = UNSET
    size_bytes: Union[None, Unset, int] = UNSET
    completed_at: Union[None, Unset, datetime.datetime] = UNSET
    error_message: Union[None, Unset, str] = UNSET
    includes_config: Union[Unset, bool] = True
    includes_files: Union[Unset, bool] = True
    includes_data: Union[Unset, bool] = True
    app_version: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        app_name = self.app_name

        status = self.status.value

        created_at = self.created_at.isoformat()

        server_version = self.server_version

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        size_bytes: Union[None, Unset, int]
        if isinstance(self.size_bytes, Unset):
            size_bytes = UNSET
        else:
            size_bytes = self.size_bytes

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

        includes_config = self.includes_config

        includes_files = self.includes_files

        includes_data = self.includes_data

        app_version: Union[None, Unset, str]
        if isinstance(self.app_version, Unset):
            app_version = UNSET
        else:
            app_version = self.app_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "app_name": app_name,
                "status": status,
                "created_at": created_at,
                "server_version": server_version,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if size_bytes is not UNSET:
            field_dict["size_bytes"] = size_bytes
        if completed_at is not UNSET:
            field_dict["completed_at"] = completed_at
        if error_message is not UNSET:
            field_dict["error_message"] = error_message
        if includes_config is not UNSET:
            field_dict["includes_config"] = includes_config
        if includes_files is not UNSET:
            field_dict["includes_files"] = includes_files
        if includes_data is not UNSET:
            field_dict["includes_data"] = includes_data
        if app_version is not UNSET:
            field_dict["app_version"] = app_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        app_name = d.pop("app_name")

        status = BackupStatus(d.pop("status"))

        created_at = isoparse(d.pop("created_at"))

        server_version = d.pop("server_version")

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_size_bytes(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        size_bytes = _parse_size_bytes(d.pop("size_bytes", UNSET))

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

        includes_config = d.pop("includes_config", UNSET)

        includes_files = d.pop("includes_files", UNSET)

        includes_data = d.pop("includes_data", UNSET)

        def _parse_app_version(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        app_version = _parse_app_version(d.pop("app_version", UNSET))

        backup_info = cls(
            id=id,
            app_name=app_name,
            status=status,
            created_at=created_at,
            server_version=server_version,
            description=description,
            size_bytes=size_bytes,
            completed_at=completed_at,
            error_message=error_message,
            includes_config=includes_config,
            includes_files=includes_files,
            includes_data=includes_data,
            app_version=app_version,
        )

        backup_info.additional_properties = d
        return backup_info

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
